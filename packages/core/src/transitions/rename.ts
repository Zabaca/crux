/**
 * Slug-rename transitions for slug-addressed entities.
 *
 * Renaming an entity changes its primary key (id = `<PREFIX>-<slug>`), which
 * means every FK referrer must be updated in lockstep. Because libSQL FKs are
 * declared without ON UPDATE CASCADE, we briefly disable FK enforcement, run
 * all the updates inside a transaction, run `PRAGMA foreign_key_check` to
 * verify integrity before commit, then re-enable FK enforcement.
 *
 * Refusal modes:
 *   - NotFoundError if the old slug does not exist.
 *   - TransitionError if the new slug is already taken by another entity of
 *     the same kind.
 */
import { eq, sql } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { ideas, problems, solutions, themes, workstreams } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

type EntityKind = "workstream" | "problem" | "solution" | "idea" | "theme";

const PREFIX: Record<EntityKind, string> = {
  workstream: "WS-",
  problem: "PRB-",
  solution: "SOL-",
  idea: "IDEA-",
  theme: "THM-",
};

/**
 * Tables that carry an FK to this entity's id, and the column name(s) to
 * update. Pure data — no logic — so adding a new referrer is a one-line
 * append.
 */
const REFERRERS: Record<EntityKind, ReadonlyArray<{ table: string; columns: string[] }>> = {
  workstream: [
    { table: "observations", columns: ["workstream_id"] },
    { table: "ideas", columns: ["workstream_id"] },
    { table: "problems", columns: ["workstream_id"] },
    { table: "themes", columns: ["workstream_id"] },
  ],
  problem: [
    { table: "evidence", columns: ["problem_id"] },
    { table: "solutions", columns: ["problem_id"] },
    { table: "eliminations", columns: ["problem_id"] },
    { table: "decisions", columns: ["problem_id"] },
    { table: "abandonments", columns: ["problem_id"] },
    { table: "outcome_follow_up_problems", columns: ["problem_id"] },
  ],
  solution: [
    { table: "elimination_solutions", columns: ["solution_id"] },
    { table: "decisions", columns: ["chosen_solution_id"] },
    { table: "decision_rejected_solutions", columns: ["solution_id"] },
    { table: "outcomes", columns: ["solution_id"] },
    { table: "theme_solutions", columns: ["solution_id"] },
  ],
  idea: [{ table: "solutions", columns: ["originating_idea_id"] }],
  theme: [{ table: "theme_solutions", columns: ["theme_id"] }],
};

/**
 * For abandonments, the entity's own id is `ABN-<problem-id>`, which embeds
 * the problem id. Renaming a problem must rewrite that id too. Captured as a
 * post-cascade hook so the generic engine doesn't need to know about it.
 */
type PostCascadeHook = (oldId: string, newId: string, db: CruxDb) => Promise<void>;

const POST_CASCADE_HOOKS: Partial<Record<EntityKind, PostCascadeHook>> = {
  problem: async (oldId, newId, db) => {
    const oldAbn = `ABN-${oldId}`;
    const newAbn = `ABN-${newId}`;
    await db.run(sql`UPDATE abandonments SET id = ${newAbn} WHERE id = ${oldAbn}`);
  },
};

export type RenameUpdates = {
  title?: string;
  description?: string;
  /** Problem-only — accepted for problem rename, ignored elsewhere. */
  priorityTier?: string | null;
};

export type RenameResult = {
  kind: EntityKind;
  oldId: string;
  newId: string;
  oldSlug: string;
  newSlug: string;
};

async function lookupBySlug(kind: EntityKind, slug: string, db: CruxDb) {
  switch (kind) {
    case "workstream":
      return (await db.select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1))[0];
    case "problem":
      return (await db.select().from(problems).where(eq(problems.slug, slug)).limit(1))[0];
    case "solution":
      return (await db.select().from(solutions).where(eq(solutions.slug, slug)).limit(1))[0];
    case "idea":
      return (await db.select().from(ideas).where(eq(ideas.slug, slug)).limit(1))[0];
    case "theme":
      return (await db.select().from(themes).where(eq(themes.slug, slug)).limit(1))[0];
  }
}

function tableNameFor(kind: EntityKind): string {
  switch (kind) {
    case "workstream":
      return "workstreams";
    case "problem":
      return "problems";
    case "solution":
      return "solutions";
    case "idea":
      return "ideas";
    case "theme":
      return "themes";
  }
}

/**
 * Generic rename engine. Validates, runs the FK cascade, applies optional
 * column updates, and verifies referential integrity before commit.
 */
export async function renameEntity(
  kind: EntityKind,
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
): Promise<RenameResult> {
  if (!oldSlug || !newSlug) {
    throw new TransitionError(`rename requires non-empty oldSlug and newSlug`, {
      kind,
      oldSlug,
      newSlug,
    });
  }

  const existing = await lookupBySlug(kind, oldSlug, db);
  if (!existing) {
    throw new NotFoundError(`${kind} not found: ${oldSlug}`, { kind, slug: oldSlug });
  }

  if (newSlug !== oldSlug) {
    const collision = await lookupBySlug(kind, newSlug, db);
    if (collision) {
      throw new TransitionError(`${kind} slug already taken: ${newSlug}`, {
        kind,
        oldSlug,
        newSlug,
      });
    }
  }

  const prefix = PREFIX[kind];
  const oldId = `${prefix}${oldSlug}`;
  const newId = `${prefix}${newSlug}`;
  const table = tableNameFor(kind);
  const referrers = REFERRERS[kind];
  const postHook = POST_CASCADE_HOOKS[kind];
  const now = Date.now();

  // PRAGMA foreign_keys must be set outside the transaction; libSQL silently
  // ignores it inside a tx. Disable, do the work, verify, re-enable.
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    await db.transaction(async (tx) => {
      // 1. Update FK referrers first (still legal because FKs are off).
      if (oldId !== newId) {
        for (const ref of referrers) {
          for (const col of ref.columns) {
            await tx.run(
              sql`UPDATE ${sql.raw(ref.table)} SET ${sql.raw(col)} = ${newId} WHERE ${sql.raw(col)} = ${oldId}`,
            );
          }
        }
      }

      // 2. Update the entity row itself: id, slug, title?, description?, priority?
      const setFragments: ReturnType<typeof sql>[] = [];
      if (oldId !== newId) {
        setFragments.push(sql`id = ${newId}`);
        setFragments.push(sql`slug = ${newSlug}`);
      }
      if (updates.title !== undefined) {
        setFragments.push(sql`title = ${updates.title}`);
      }
      if (updates.description !== undefined) {
        setFragments.push(sql`description = ${updates.description}`);
      }
      if (kind === "problem" && updates.priorityTier !== undefined) {
        setFragments.push(sql`priority_tier = ${updates.priorityTier}`);
      }
      // Bump updated_at on tables that have it (themes does not).
      if (kind !== "theme") {
        setFragments.push(sql`updated_at = ${now}`);
      }
      if (setFragments.length > 0) {
        const setClause = sql.join(setFragments, sql`, `);
        await tx.run(sql`UPDATE ${sql.raw(table)} SET ${setClause} WHERE id = ${oldId}`);
      }

      // 3. Per-entity cleanup (e.g. abandonments.id rewrite for problem).
      if (postHook && oldId !== newId) await postHook(oldId, newId, tx as unknown as CruxDb);

      // 4. Verify FK integrity *before* committing. PRAGMA foreign_key_check
      // returns 0 rows when clean; any rows = a violation we must surface.
      const violations = await tx.all(sql`PRAGMA foreign_key_check`);
      if (Array.isArray(violations) && violations.length > 0) {
        throw new TransitionError(`rename produced FK violations`, {
          kind,
          oldSlug,
          newSlug,
          violations,
        });
      }
    });
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }

  return { kind, oldId, newId, oldSlug, newSlug };
}

// Convenience wrappers — keep the entity-specific verbs callable directly.
export const renameWorkstream = (
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
) => renameEntity("workstream", oldSlug, newSlug, updates, db);

export const renameProblem = (
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
) => renameEntity("problem", oldSlug, newSlug, updates, db);

export const renameSolution = (
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
) => renameEntity("solution", oldSlug, newSlug, updates, db);

export const renameIdea = (oldSlug: string, newSlug: string, updates: RenameUpdates, db: CruxDb) =>
  renameEntity("idea", oldSlug, newSlug, updates, db);

export const renameTheme = (oldSlug: string, newSlug: string, updates: RenameUpdates, db: CruxDb) =>
  renameEntity("theme", oldSlug, newSlug, updates, db);
