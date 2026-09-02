/**
 * runMutation — maps a MutationAction to the appropriate transition call.
 *
 * Every id a payload carries is resolved through the caller's `Scope` before it
 * is touched (ADR-0013). Scoping only the reads would not hold the boundary: an
 * `ADD_EVIDENCE` that linked somebody else's Observation to your own Problem
 * would put their words inside your corpus, and every read after that would
 * disclose them while doing exactly its job. A row outside the scope is reported
 * as missing, in the same words as one that never existed.
 */
import type { CruxDb } from "../db/client.js";
import { workstreams, problems, observations, outcomes, attempts } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import { problemsInScope, type Scope } from "../auth/principals.js";
import {
  scheduleProblem,
  unscheduleProblem,
  abandonProblem,
  createAttempt,
  closeAttempt,
  recordOutcome,
  archiveObservation,
  renameWorkstream,
  NotFoundError,
  type RoadmapStage,
} from "../transitions/index.js";
import type { MutationAction } from "./schemas.js";

async function countRows(
  tableName: "observations" | "outcomes" | "attempts",
  db: CruxDb,
): Promise<number> {
  if (tableName === "observations") {
    const rows = await db.select({ id: observations.id }).from(observations);
    const nums = rows.map((r) => Number(r.id.replace(/^OBS-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  if (tableName === "attempts") {
    const rows = await db.select({ id: attempts.id }).from(attempts);
    const nums = rows.map((r) => Number(r.id.replace(/^ATT-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  if (tableName === "outcomes") {
    const rows = await db.select({ id: outcomes.id }).from(outcomes);
    const nums = rows.map((r) => Number(r.id.replace(/^OUT-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  return 0;
}

async function resolveWs(slugOrId: string, db: CruxDb, scope: Scope) {
  const missing = () => new NotFoundError(`workstream not found: ${slugOrId}`, { slug: slugOrId });
  const byId = (
    await db.select().from(workstreams).where(eq(workstreams.id, slugOrId)).limit(1)
  )[0];
  if (byId) {
    if (!scope.has(byId.id)) throw missing();
    return byId;
  }
  const bySlug = (
    await db.select().from(workstreams).where(eq(workstreams.slug, slugOrId)).limit(1)
  )[0];
  if (bySlug) {
    if (!scope.has(bySlug.id)) throw missing();
    return bySlug;
  }
  throw missing();
}

function toIntId(id: string | number): number {
  return typeof id === "number" ? id : parseInt(id, 10);
}

async function resolveProblem(id: string | number, db: CruxDb, scope: Scope) {
  const numId = toIntId(id);
  const rows = await db.select().from(problems).where(eq(problems.id, numId)).limit(1);
  const row = rows[0];
  if (!row || !scope.has(row.workstreamId))
    throw new NotFoundError(`problem not found: ${id}`, { id });
  return row;
}

/** The Observation `id` names, if it sits in a Workstream this Principal owns. */
async function resolveObservation(id: string, db: CruxDb, scope: Scope) {
  const rows = await db.select().from(observations).where(eq(observations.id, id)).limit(1);
  const row = rows[0];
  if (!row || !scope.has(row.workstreamId)) {
    throw new NotFoundError(`observation not found: ${id}`, { id });
  }
  return row;
}

/** The Attempt `id` names, if its Problem is inside the scope. */
async function resolveAttempt(id: string, db: CruxDb, scope: Scope) {
  const rows = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.id, id), inArray(attempts.problemId, problemsInScope(db, scope))))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`attempt not found: ${id}`, { id });
  return row;
}

/**
 * Who a mutation is attributed to — the token-resolved user. Required for the
 * same reason the ViewStore is: the only fallback available would read the
 * caller's local `config.toml`, which is `node:fs` in the Worker bundle.
 */
export type Actor = { id: string };

export async function runMutation(
  action: MutationAction,
  db: CruxDb,
  actor: Actor,
  scope: Scope,
): Promise<unknown> {
  const user = actor;

  switch (action.kind) {
    case "ADD_WORKSTREAM": {
      const p = action.payload;
      const id = `WS-${p.slug}`;
      await db.insert(workstreams).values({
        id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        ownerId: user.id,
      });
      return { ok: true, id };
    }
    case "RENAME_WORKSTREAM": {
      const p = action.payload;
      await resolveWs(p.oldSlug, db, scope);
      const r = await renameWorkstream(
        p.oldSlug,
        p.newSlug,
        { title: p.title, description: p.description },
        db,
      );
      return { ok: true, ...r };
    }
    case "ADD_PROBLEM": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream, db, scope);
      const result = await db
        .insert(problems)
        .values({
          workstreamId: ws.id,
          title: p.title,
          description: p.description,
          createdById: user.id,
        })
        .returning({ id: problems.id });
      const id = result[0]!.id;
      return { ok: true, id };
    }
    case "SCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.id, db, scope);
      await scheduleProblem(prob.id, p.stage as RoadmapStage, db);
      return { ok: true, id: prob.id, status: p.stage };
    }
    case "UNSCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.id, db, scope);
      await unscheduleProblem(prob.id, db);
      return { ok: true, id: prob.id, status: null };
    }
    case "ABANDON_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.id, db, scope);
      await abandonProblem(prob.id, p.rationale, user.id, db);
      return { ok: true, id: prob.id, status: "abandoned" };
    }
    case "ADD_ATTEMPT": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem, db, scope);
      const n = await countRows("attempts", db);
      const id = `ATT-${String(n + 1).padStart(3, "0")}`;
      await createAttempt(
        { id, problemId: prob.id, ref: p.ref, label: p.label, createdById: user.id },
        db,
      );
      return { ok: true, id };
    }
    case "CLOSE_ATTEMPT": {
      const p = action.payload;
      await resolveAttempt(p.id, db, scope);
      await closeAttempt({ id: p.id, status: p.status, closingNote: p.closingNote }, db);
      return { ok: true, id: p.id, status: p.status };
    }
    case "ADD_OUTCOME": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem, db, scope);
      const n = await countRows("outcomes", db);
      const id = `OUT-${String(n + 1).padStart(3, "0")}`;
      await recordOutcome(
        {
          id,
          problemId: prob.id,
          observedImpact: p.observedImpact,
          learnings: p.learnings,
          // Not scope-checked here: `recordOutcome` already refuses a follow-up
          // that is not in the same Workstream as the Problem, and the Problem
          // is in scope, so same-Workstream *is* in-scope. Adding a second gate
          // would only replace REFERENTIAL_MISMATCH with a less accurate code.
          followUpProblemIds: p.followUpProblemIds ? p.followUpProblemIds.map(toIntId) : [],
          createdById: user.id,
        },
        db,
      );
      return { ok: true, id, status: "done" };
    }
    case "ADD_OBSERVATION": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream, db, scope);
      const n = await countRows("observations", db);
      const id = `OBS-${String(n + 1).padStart(3, "0")}`;
      await db.insert(observations).values({
        id,
        workstreamId: ws.id,
        reporterId: user.id,
        content: p.content,
        source: p.source,
        sourceType: p.sourceType,
        tags: p.tags && p.tags.length ? JSON.stringify(p.tags) : null,
      });
      return { ok: true, id };
    }
    case "ARCHIVE_OBSERVATION": {
      const p = action.payload;
      await resolveObservation(p.id, db, scope);
      await archiveObservation(p.id, p.rationale ?? "", user.id, db);
      return { ok: true, id: p.id };
    }
    case "ADD_EVIDENCE": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem, db, scope);
      await resolveObservation(p.observation, db, scope);
      const { evidence } = await import("../db/schema.js");
      const existingEvidence = await db.select({ id: evidence.id }).from(evidence);
      const nums = existingEvidence
        .map((r) => Number(r.id.replace(/^EVD-/, "")))
        .filter(Number.isFinite);
      const nextNum = (nums.length ? Math.max(...nums) : 0) + 1;
      const id = `EVD-${String(nextNum).padStart(3, "0")}`;
      await db.insert(evidence).values({
        id,
        observationId: p.observation,
        problemId: prob.id,
        note: p.note,
        createdById: user.id,
      });
      return { ok: true, id };
    }
    case "RENAME_OBSERVATION": {
      const p = action.payload;
      await resolveObservation(p.id, db, scope);
      await db.update(observations).set({ content: p.content }).where(eq(observations.id, p.id));
      return { ok: true, id: p.id };
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown mutation kind: ${(_exhaustive as MutationAction).kind}`);
    }
  }
}
