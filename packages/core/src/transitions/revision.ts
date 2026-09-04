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
import type { BatchItem } from "drizzle-orm/batch";

import { runBatch, type CruxDb } from "../db/client.js";
import { attempts, observations, problems, revisions } from "../db/schema.js";
import { NotFoundError, ValidationError } from "./errors.js";

/** Which kind of row a revision corrects. Storage is polymorphic; the API is not. */
export type RevisableEntity = "problem" | "observation" | "attempt";

export type RevisionResult = {
  /** The revision row that recorded the previous values. */
  revisionId: string;
  /**
   * Which fields actually changed. Names only — the *values* they used to hold
   * are what the history read answers with, and calling both `changed` would
   * put two different meanings one command apart.
   */
  changedFields: string[];
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

/** The fields the caller actually named, for a refusal that says what it saw. */
const namedFields = (updates: Record<string, string | undefined>): string[] =>
  Object.keys(updates).filter((f) => updates[f] !== undefined);

/**
 * Write the history row and the corrected row together.
 *
 * One batch, so a correction can never land without the record of what it
 * replaced — the durability that ADR-0017 substitutes for the freeze it lifts.
 */
async function commitRevision(
  db: CruxDb,
  entity: RevisableEntity,
  entityId: string | number,
  previous: Record<string, string>,
  reason: string | undefined,
  userId: string,
  now: number,
  update: BatchItem<"sqlite">,
): Promise<RevisionResult> {
  const revisionId = await nextRevisionId(db);
  await runBatch(db, [
    db.insert(revisions).values({
      id: revisionId,
      entity,
      entityId: String(entityId),
      changed: JSON.stringify(previous),
      reason,
      revisedById: userId,
      revisedAt: now,
    }),
    update,
  ]);
  return { revisionId, changedFields: Object.keys(previous) };
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
  if (Object.keys(previous).length === 0) {
    throw new ValidationError(`revision leaves Problem ${problemId} unchanged`, {
      problemId,
      fields: namedFields(updates),
    });
  }

  const now = Date.now();
  const set: Partial<typeof problems.$inferInsert> = { updatedAt: now };
  if ("title" in previous) set.title = updates.title;
  if ("description" in previous) set.description = updates.description;

  return commitRevision(
    db,
    "problem",
    problemId,
    previous,
    reason,
    userId,
    now,
    db.update(problems).set(set).where(eq(problems.id, problemId)),
  );
}

export type ObservationRevision = {
  content?: string;
};

/**
 * Correct what an Observation says.
 *
 * The entity model called an Observation immutable, and that freeze was always
 * a proxy for durability: an edit with no record is indistinguishable from a
 * fabrication. The history provides durability directly, so the proxy is
 * retired (ADR-0017).
 *
 * An **archived** Observation is still revisable. The two claims are
 * orthogonal: archiving says the row stopped being live, revision says it was
 * wrong, and a retired row that misstates what was seen is exactly the one
 * worth correcting — it is still reachable by id and under any Problem's
 * Evidence, so a falsehood in it still informs a live conclusion.
 */
export async function reviseObservation(
  observationId: string,
  updates: ObservationRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  if (updates.content === undefined) {
    throw new ValidationError(`a revision must name content`, { observationId });
  }

  const row = (
    await db.select().from(observations).where(eq(observations.id, observationId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError(`Observation not found: ${observationId}`, { observationId });

  const previous = previousValues({ content: row.content }, updates);
  if (Object.keys(previous).length === 0) {
    throw new ValidationError(`revision leaves Observation ${observationId} unchanged`, {
      observationId,
      fields: namedFields(updates),
    });
  }

  const now = Date.now();
  return commitRevision(
    db,
    "observation",
    observationId,
    previous,
    reason,
    userId,
    now,
    db
      .update(observations)
      .set({ content: updates.content, updatedAt: now })
      .where(eq(observations.id, observationId)),
  );
}

export type AttemptRevision = {
  ref?: string;
  label?: string;
  closingNote?: string;
};

/**
 * Correct an Attempt's pointer, its label, or the note that closed it.
 *
 * Nothing here touches `status`. Getting a `ref` wrong used to cost a terminal
 * transition — the only repair was to close the Attempt `dropped` and refile,
 * which left a dropped Attempt representing no abandoned work — and a
 * correction is not a transition (ADR-0012, ADR-0017).
 *
 * A closing note may only be corrected on an Attempt that has one. On an open
 * Attempt there is nothing to correct, and writing one would be closing it
 * through a door that records no judgment.
 */
export async function reviseAttempt(
  attemptId: string,
  updates: AttemptRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  if (namedFields(updates).length === 0) {
    throw new ValidationError(`a revision must name at least one of ref, label, closingNote`, {
      attemptId,
    });
  }

  // Trimmed and refused empty, the way `createAttempt` does: an Attempt with
  // no destination or no name is a row that answers nothing, and a correction
  // is not a way around the invariant that filing one enforces.
  for (const [field, value] of Object.entries(updates)) {
    if (value !== undefined && value.trim() === "") {
      throw new ValidationError(`Attempt ${field} cannot be corrected to nothing`, {
        attemptId,
        field,
      });
    }
  }
  const trimmed: AttemptRevision = {
    ...(updates.ref !== undefined ? { ref: updates.ref.trim() } : {}),
    ...(updates.label !== undefined ? { label: updates.label.trim() } : {}),
    ...(updates.closingNote !== undefined ? { closingNote: updates.closingNote.trim() } : {}),
  };

  const row = (await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1))[0];
  if (!row) throw new NotFoundError(`Attempt not found: ${attemptId}`, { attemptId });

  if (trimmed.closingNote !== undefined && row.closingNote === null) {
    throw new ValidationError(
      `Attempt ${attemptId} is ${row.status} and has no closing note to correct`,
      { attemptId, status: row.status },
    );
  }

  const current: Record<string, string> = { ref: row.ref, label: row.label };
  if (row.closingNote !== null) current.closingNote = row.closingNote;

  const previous = previousValues(current, trimmed);
  if (Object.keys(previous).length === 0) {
    throw new ValidationError(`revision leaves Attempt ${attemptId} unchanged`, {
      attemptId,
      fields: namedFields(updates),
    });
  }

  const now = Date.now();
  const set: Partial<typeof attempts.$inferInsert> = { updatedAt: now };
  if ("ref" in previous) set.ref = trimmed.ref;
  if ("label" in previous) set.label = trimmed.label;
  if ("closingNote" in previous) set.closingNote = trimmed.closingNote;

  return commitRevision(
    db,
    "attempt",
    attemptId,
    previous,
    reason,
    userId,
    now,
    db.update(attempts).set(set).where(eq(attempts.id, attemptId)),
  );
}
