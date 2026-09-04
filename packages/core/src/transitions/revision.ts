/**
 * Revision: a row may be corrected, and what it used to say is kept
 * (ADR-0017).
 *
 * The row is edited in place — it stays the single source of current truth —
 * and the values it is losing are appended to `revisions`. Nothing reconstructs
 * state from that table; it is a side record, read only when somebody asks what
 * a row used to say.
 *
 * `entity` and the stringified `entityId` are what make one table serve every
 * kind of row. The *caller* stays typed: `reviseProblem` names the two fields a
 * Problem has, so a `content` can never be handed to one.
 */
import { eq } from "drizzle-orm";

import { runBatch, type CruxDb } from "../db/client.js";
import { problems, revisions } from "../db/schema.js";
import { NotFoundError, ValidationError } from "./errors.js";

/** Which kind of row a revision corrects. Storage is polymorphic; the API is not. */
export type RevisableEntity = "problem";

export type RevisionResult = {
  /** The revision row that recorded the previous values. */
  revisionId: string;
  /** Which fields actually changed, in the order they were checked. */
  changed: string[];
};

/**
 * The next `REV-###`, by the same max-of-the-suffixes rule the other prefixed
 * ids use. Every entity shares the sequence, because they share the table.
 */
async function nextRevisionId(db: CruxDb): Promise<string> {
  const rows = await db.select({ id: revisions.id }).from(revisions);
  const nums = rows.map((r) => Number(r.id.replace(/^REV-/, ""))).filter(Number.isFinite);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `REV-${String(next).padStart(3, "0")}`;
}

/**
 * The fields a revision is actually going to change, with the values they are
 * losing.
 *
 * A field the caller did not name is untouched; a field whose new value already
 * equals the current one is not a change, and a call that changes nothing is a
 * refusal rather than a write that reports success without one.
 */
function previousValues(
  current: Record<string, string>,
  updates: Record<string, string | undefined>,
): Record<string, string> {
  const previous: Record<string, string> = {};
  for (const [field, next] of Object.entries(updates)) {
    const was = current[field];
    if (next === undefined || was === undefined || next === was) continue;
    previous[field] = was;
  }
  return previous;
}

export type ProblemRevision = {
  title?: string;
  description?: string;
};

/**
 * Correct a Problem's title, its description, or both.
 *
 * `reason` is optional by decision: the model demands one at terminal doors —
 * `ABANDON_PROBLEM`, `COMPLETE_PROBLEM` — and leaves it optional at reversible
 * ones, and a revision is reversible because you can revise again (ADR-0017).
 */
export async function reviseProblem(
  problemId: number,
  updates: ProblemRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  if (updates.title === undefined && updates.description === undefined) {
    throw new ValidationError(`a revision must name at least one of title, description`, {
      problemId,
    });
  }

  const row = (await db.select().from(problems).where(eq(problems.id, problemId)).limit(1))[0];
  if (!row) throw new NotFoundError(`Problem not found: ${problemId}`, { problemId });

  const previous = previousValues({ title: row.title, description: row.description }, updates);
  const changed = Object.keys(previous);
  if (changed.length === 0) {
    throw new ValidationError(`revision leaves Problem ${problemId} unchanged`, {
      problemId,
      fields: Object.keys(updates).filter((f) => updates[f as keyof ProblemRevision] !== undefined),
    });
  }

  const now = Date.now();
  const revisionId = await nextRevisionId(db);
  const set: Partial<typeof problems.$inferInsert> = { updatedAt: now };
  if (changed.includes("title")) set.title = updates.title;
  if (changed.includes("description")) set.description = updates.description;

  await runBatch(db, [
    db.insert(revisions).values({
      id: revisionId,
      entity: "problem" satisfies RevisableEntity,
      entityId: String(problemId),
      changed: JSON.stringify(previous),
      reason,
      revisedById: userId,
      revisedAt: now,
    }),
    db.update(problems).set(set).where(eq(problems.id, problemId)),
  ]);

  return { revisionId, changed };
}
