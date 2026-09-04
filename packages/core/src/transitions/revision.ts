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
 * kind of row. The *callers* stay typed: `reviseProblem` names the two fields a
 * Problem has, so a `content` can never be handed to one, `reviseAttempt` cannot
 * reach a `status`, and `reviseWorkstream` cannot reach a slug at all.
 */
import { eq } from "drizzle-orm";

import type { BatchItem } from "drizzle-orm/batch";

import { runBatch, type CruxDb } from "../db/client.js";
import {
  abandonments,
  attempts,
  evidence,
  observations,
  outcomes,
  problems,
  revisions,
  workstreams,
} from "../db/schema.js";
import { InvariantError, NotFoundError, ValidationError } from "./errors.js";

/** Which kind of row a revision corrects. Storage is polymorphic; the API is not. */
export type RevisableEntity =
  | "problem"
  | "observation"
  | "attempt"
  | "evidence"
  | "outcome"
  | "abandonment"
  | "workstream";

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
 *
 * A previous value may be `null` — an Evidence note, an Outcome's learnings and
 * a Workstream's description are all nullable — and that is a value the history
 * has to keep, not an absence to skip: "it used to say nothing" is exactly what
 * a reader is asking.
 */
function previousValues(
  current: Record<string, string | null>,
  updates: Record<string, string | undefined>,
): Record<string, string | null> {
  const previous: Record<string, string | null> = {};
  for (const [field, next] of Object.entries(updates)) {
    if (next === undefined) continue;
    // A field the row does not have is a wiring mistake, and the one failure
    // ADR-0017 names by name: input accepted, not honoured, success reported.
    // The `.strict()` payloads are the outer guard; this is the belt.
    if (!(field in current)) {
      throw new ValidationError(`no such field to revise: ${field}`, { field });
    }
    const was = current[field] ?? null;
    if (next === was) continue;
    previous[field] = was;
  }
  return previous;
}

/**
 * The half of a revision that is the same whichever row is being corrected:
 * refuse a call that names nothing, work out what is actually changing, refuse
 * one that changes nothing, and write the side record and the row together.
 *
 * The caller supplies `updateRow` rather than a table, because the `set` it
 * builds is what keeps each entity's fields typed — the polymorphism stops at
 * the storage row this function writes.
 */
async function applyRevision(args: {
  db: CruxDb;
  entity: RevisableEntity;
  entityId: string | number;
  /** What the row says now, field by field — the values the history will keep. */
  current: Record<string, string | null>;
  /** Every revisable field as an explicit key; an unnamed one carries `undefined`. */
  updates: Record<string, string | undefined>;
  reason: string | undefined;
  userId: string;
  updateRow: (changedFields: string[], now: number) => BatchItem<"sqlite">;
}): Promise<RevisionResult> {
  const { db, entity, entityId, current, updates, reason, userId, updateRow } = args;
  const previous = previousValues(current, updates);
  const changedFields = Object.keys(previous);
  if (changedFields.length === 0) {
    throw new ValidationError(`revision leaves ${entity} ${entityId} unchanged`, {
      id: entityId,
      fields: namedFields(updates),
    });
  }

  const now = Date.now();
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
    updateRow(changedFields, now),
  ]);

  return { revisionId, changedFields };
}

/** The fields the caller actually named, for a refusal that says what it saw. */
const namedFields = (updates: Record<string, string | undefined>): string[] =>
  Object.keys(updates).filter((f) => updates[f] !== undefined);

/**
 * A revision that names no field is a refusal, not an empty write.
 *
 * Every caller passes each of its revisable fields as an explicit key — an
 * omitted one carrying `undefined` — so the keys are the field list this
 * refusal quotes back.
 */
function requireSomeField(
  entityId: string | number,
  updates: Record<string, string | undefined>,
): void {
  if (namedFields(updates).length === 0) {
    throw new ValidationError(
      `a revision must name at least one of ${Object.keys(updates).join(", ")}`,
      { id: entityId },
    );
  }
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
  const named = { title: updates.title, description: updates.description };
  requireSomeField(problemId, named);

  const row = (await db.select().from(problems).where(eq(problems.id, problemId)).limit(1))[0];
  if (!row) throw new NotFoundError(`Problem not found: ${problemId}`, { problemId });

  return applyRevision({
    db,
    entity: "problem",
    entityId: problemId,
    current: { title: row.title, description: row.description },
    updates: named,
    reason,
    userId,
    updateRow: (changed, now) => {
      const set: Partial<typeof problems.$inferInsert> = { updatedAt: now };
      if (changed.includes("title")) set.title = updates.title;
      if (changed.includes("description")) set.description = updates.description;
      return db.update(problems).set(set).where(eq(problems.id, problemId));
    },
  });
}

export type ObservationRevision = {
  content: string;
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
  if (updates.content.trim() === "") {
    // An Observation blanked to whitespace is the raw signal destroyed, which
    // is the one thing lifting the freeze may not be allowed to do (ADR-0017).
    throw new InvariantError(`an Observation cannot be corrected to nothing`, { observationId });
  }

  const row = (
    await db.select().from(observations).where(eq(observations.id, observationId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError(`Observation not found: ${observationId}`, { observationId });

  return applyRevision({
    db,
    entity: "observation",
    entityId: observationId,
    current: { content: row.content },
    updates: { content: updates.content },
    reason,
    userId,
    updateRow: (changed, now) => {
      const set: Partial<typeof observations.$inferInsert> = { updatedAt: now };
      if (changed.includes("content")) set.content = updates.content;
      return db.update(observations).set(set).where(eq(observations.id, observationId));
    },
  });
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
  requireSomeField(attemptId, {
    ref: updates.ref,
    label: updates.label,
    closingNote: updates.closingNote,
  });

  // Trimmed and refused empty, the way `createAttempt` does: an Attempt with
  // no destination or no name is a row that answers nothing, and a correction
  // is not a way around the invariant that filing one enforces.
  for (const [field, value] of Object.entries(updates)) {
    if (value !== undefined && value.trim() === "") {
      // `InvariantError`, the code `createAttempt` raises for the same rule:
      // one invariant that answers with two codes is two rules to a caller
      // parsing them.
      throw new InvariantError(`Attempt ${field} cannot be corrected to nothing`, {
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

  return applyRevision({
    db,
    entity: "attempt",
    entityId: attemptId,
    current: { ref: row.ref, label: row.label, closingNote: row.closingNote },
    updates: {
      ref: trimmed.ref,
      label: trimmed.label,
      closingNote: trimmed.closingNote,
    },
    reason,
    userId,
    updateRow: (changed, now) => {
      const set: Partial<typeof attempts.$inferInsert> = { updatedAt: now };
      if (changed.includes("ref")) set.ref = trimmed.ref;
      if (changed.includes("label")) set.label = trimmed.label;
      if (changed.includes("closingNote")) set.closingNote = trimmed.closingNote;
      return db.update(attempts).set(set).where(eq(attempts.id, attemptId));
    },
  });
}

export type EvidenceRevision = {
  note?: string;
};

/**
 * Correct the why-note on an Evidence link.
 *
 * The link itself — which Observation supports which Problem — is not revisable:
 * that is an assertion, not a sentence, and unmaking it is a different act with
 * a different name. Only the note the assertion carries can be wrong.
 */
export async function reviseEvidence(
  evidenceId: string,
  updates: EvidenceRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  const named = { note: updates.note };
  requireSomeField(evidenceId, named);

  const row = (await db.select().from(evidence).where(eq(evidence.id, evidenceId)).limit(1))[0];
  if (!row) throw new NotFoundError(`evidence not found: ${evidenceId}`, { id: evidenceId });

  return applyRevision({
    db,
    entity: "evidence",
    entityId: evidenceId,
    current: { note: row.note },
    updates: named,
    reason,
    userId,
    updateRow: (changed) => {
      const set: Partial<typeof evidence.$inferInsert> = {};
      if (changed.includes("note")) set.note = updates.note;
      return db.update(evidence).set(set).where(eq(evidence.id, evidenceId));
    },
  });
}

export type OutcomeRevision = {
  observedImpact?: string;
  learnings?: string;
};

/**
 * Correct what an Outcome measured, or what was learned from it.
 *
 * This rewrites a terminal judgment, deliberately (ADR-0017). What it does not
 * touch is the transition: the Problem stays `done`, the Outcome stays the one
 * Outcome its Problem is allowed, and `recordOutcome` still refuses a second.
 * A retracted measurement leaves a trace in the history instead of quietly
 * becoming a different claim.
 */
export async function reviseOutcome(
  outcomeId: string,
  updates: OutcomeRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  const named = { observedImpact: updates.observedImpact, learnings: updates.learnings };
  requireSomeField(outcomeId, named);

  const row = (await db.select().from(outcomes).where(eq(outcomes.id, outcomeId)).limit(1))[0];
  if (!row) throw new NotFoundError(`outcome not found: ${outcomeId}`, { id: outcomeId });

  return applyRevision({
    db,
    entity: "outcome",
    entityId: outcomeId,
    current: { observedImpact: row.observedImpact, learnings: row.learnings },
    updates: named,
    reason,
    userId,
    updateRow: (changed) => {
      const set: Partial<typeof outcomes.$inferInsert> = {};
      if (changed.includes("observedImpact")) set.observedImpact = updates.observedImpact;
      if (changed.includes("learnings")) set.learnings = updates.learnings;
      return db.update(outcomes).set(set).where(eq(outcomes.id, outcomeId));
    },
  });
}

export type AbandonmentRevision = {
  rationale?: string;
};

/**
 * Correct why a Problem was given up on.
 *
 * As with an Outcome, the prose changes and the judgment does not: the Problem
 * stays `abandoned`, and nothing here is a route back onto the board.
 */
export async function reviseAbandonment(
  abandonmentId: string,
  updates: AbandonmentRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  const named = { rationale: updates.rationale };
  requireSomeField(abandonmentId, named);

  const row = (
    await db.select().from(abandonments).where(eq(abandonments.id, abandonmentId)).limit(1)
  )[0];
  if (!row)
    throw new NotFoundError(`abandonment not found: ${abandonmentId}`, { id: abandonmentId });

  return applyRevision({
    db,
    entity: "abandonment",
    entityId: abandonmentId,
    current: { rationale: row.rationale },
    updates: named,
    reason,
    userId,
    updateRow: (changed) => {
      const set: Partial<typeof abandonments.$inferInsert> = {};
      if (changed.includes("rationale")) set.rationale = updates.rationale;
      return db.update(abandonments).set(set).where(eq(abandonments.id, abandonmentId));
    },
  });
}

export type WorkstreamRevision = {
  title?: string;
  description?: string;
};

/**
 * Correct a Workstream's title or description.
 *
 * The slug is deliberately absent and unreachable from here: it is not
 * something the row said but how the row is addressed — by every `-w`, every
 * URL and every reference an agent has stored — and it carries tenancy meaning
 * under ADR-0016. `RENAME_WORKSTREAM` keeps it, so re-addressing a corpus can
 * never be mistaken for fixing a sentence.
 */
export async function reviseWorkstream(
  workstreamId: string,
  updates: WorkstreamRevision,
  reason: string | undefined,
  userId: string,
  db: CruxDb,
): Promise<RevisionResult> {
  const named = { title: updates.title, description: updates.description };
  requireSomeField(workstreamId, named);

  const row = (
    await db.select().from(workstreams).where(eq(workstreams.id, workstreamId)).limit(1)
  )[0];
  if (!row) throw new NotFoundError(`workstream not found: ${workstreamId}`, { id: workstreamId });

  return applyRevision({
    db,
    entity: "workstream",
    entityId: workstreamId,
    current: { title: row.title, description: row.description },
    updates: named,
    reason,
    userId,
    updateRow: (changed, now) => {
      const set: Partial<typeof workstreams.$inferInsert> = { updatedAt: now };
      if (changed.includes("title")) set.title = updates.title;
      if (changed.includes("description")) set.description = updates.description;
      return db.update(workstreams).set(set).where(eq(workstreams.id, workstreamId));
    },
  });
}
