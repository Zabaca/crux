/**
 * Slug-rename transition for workstreams.
 *
 * Renaming a workstream changes its primary key (id = "WS-<slug>"), which
 * means every FK referrer must be updated in lockstep. Because libSQL FKs are
 * declared without ON UPDATE CASCADE, we briefly disable FK enforcement, run
 * all the updates inside a transaction, run `PRAGMA foreign_key_check` to
 * verify integrity before commit, then re-enable FK enforcement.
 */
import { eq, sql } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { workstreams } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

export type RenameUpdates = {
  title?: string;
  description?: string;
};

export type RenameResult = {
  kind: "workstream";
  oldId: string;
  newId: string;
  oldSlug: string;
  newSlug: string;
};

const WORKSTREAM_REFERRERS: ReadonlyArray<{ table: string; columns: string[] }> = [
  { table: "observations", columns: ["workstream_id"] },
  { table: "problems", columns: ["workstream_id"] },
];

export async function renameWorkstream(
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
): Promise<RenameResult> {
  if (!oldSlug || !newSlug) {
    throw new TransitionError(`rename requires non-empty oldSlug and newSlug`, {
      kind: "workstream",
      oldSlug,
      newSlug,
    });
  }

  const existing = (
    await db.select().from(workstreams).where(eq(workstreams.slug, oldSlug)).limit(1)
  )[0];
  if (!existing) {
    throw new NotFoundError(`workstream not found: ${oldSlug}`, {
      kind: "workstream",
      slug: oldSlug,
    });
  }

  if (newSlug !== oldSlug) {
    const collision = (
      await db.select().from(workstreams).where(eq(workstreams.slug, newSlug)).limit(1)
    )[0];
    if (collision) {
      throw new TransitionError(`workstream slug already taken: ${newSlug}`, {
        kind: "workstream",
        oldSlug,
        newSlug,
      });
    }
  }

  const oldId = `WS-${oldSlug}`;
  const newId = `WS-${newSlug}`;
  const now = Date.now();

  await db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    await db.transaction(async (tx) => {
      if (oldId !== newId) {
        for (const ref of WORKSTREAM_REFERRERS) {
          for (const col of ref.columns) {
            await tx.run(
              sql`UPDATE ${sql.raw(ref.table)} SET ${sql.raw(col)} = ${newId} WHERE ${sql.raw(col)} = ${oldId}`,
            );
          }
        }
      }

      const setFragments: ReturnType<typeof sql>[] = [];
      if (oldId !== newId) {
        setFragments.push(sql`id = ${newId}`);
        setFragments.push(sql`slug = ${newSlug}`);
      }
      if (updates.title !== undefined) setFragments.push(sql`title = ${updates.title}`);
      if (updates.description !== undefined)
        setFragments.push(sql`description = ${updates.description}`);
      setFragments.push(sql`updated_at = ${now}`);
      const setClause = sql.join(setFragments, sql`, `);
      await tx.run(sql`UPDATE workstreams SET ${setClause} WHERE id = ${oldId}`);

      const violations = await tx.all(sql`PRAGMA foreign_key_check`);
      if (Array.isArray(violations) && violations.length > 0) {
        throw new TransitionError(`rename produced FK violations`, {
          kind: "workstream",
          oldSlug,
          newSlug,
          violations,
        });
      }
    });
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }

  return { kind: "workstream", oldId, newId, oldSlug, newSlug };
}
