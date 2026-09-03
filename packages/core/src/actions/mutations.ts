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
import { eq } from "drizzle-orm";
import {
  findProblemInScope,
  requireAttemptInScope,
  requireObservationInScope,
  requireProblemInScope,
  requireWorkstreamInScope,
  type Scope,
} from "../auth/principals.js";
import {
  scheduleProblem,
  unscheduleProblem,
  abandonProblem,
  createAttempt,
  closeAttempt,
  recordOutcome,
  archiveObservation,
  renameWorkstream,
  CruxError,
  ReferentialError,
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

function toIntId(id: string | number): number {
  return typeof id === "number" ? id : parseInt(id, 10);
}

/**
 * Who a mutation is attributed to — the token-resolved user. Required for the
 * same reason the ViewStore is: the only fallback available would read the
 * caller's local `config.toml`, which is `node:fs` in the Worker bundle.
 */
export type Actor = { id: string };

/**
 * Follow-up Problem ids the caller may actually refer to.
 *
 * A follow-up outside the scope is reported with the same message `recordOutcome`
 * uses for one that does not exist, so the two are one answer.
 */
async function scopedFollowUps(
  ids: Array<string | number> | undefined,
  db: CruxDb,
  scope: Scope,
): Promise<number[]> {
  if (!ids?.length) return [];
  return Promise.all(
    ids.map(async (raw) => {
      const id = toIntId(raw);
      if (!(await findProblemInScope(db, id, scope))) {
        throw new ReferentialError(`Problem not found: ${id}`, { problemId: id });
      }
      return id;
    }),
  );
}

/**
 * What a mutation did, plus where it did it.
 *
 * `workstreamId` is the Workstream whose data moved — the change event carries
 * it so a subscriber watching one Workstream can ignore the rest. It is read
 * off the rows the scope check already resolved, so naming it costs no extra
 * query and can never name a Workstream outside the caller's scope.
 */
export type MutationOutcome = {
  result: unknown;
  workstreamId: string | null;
};

export async function runMutation(
  action: MutationAction,
  db: CruxDb,
  actor: Actor,
  scope: Scope,
): Promise<MutationOutcome> {
  const user = actor;

  switch (action.kind) {
    case "ADD_WORKSTREAM": {
      const p = action.payload;
      const id = `WS-${p.slug}`;
      // The slug namespace is the deployment's, not the Principal's: `WS-<slug>`
      // is the primary key and `slug` is uniquely indexed. On a deployment many
      // Principals share, the first anonymous adopter to pick "crux" takes it,
      // and the second needs to be told that in words rather than handed a raw
      // constraint failure as a 500 on their very first command.
      const taken = await db
        .select({ id: workstreams.id })
        .from(workstreams)
        .where(eq(workstreams.id, id));
      if (taken.length) {
        throw new CruxError(
          "ALREADY_EXISTS",
          `the slug "${p.slug}" is taken on this deployment — choose another`,
          { slug: p.slug },
        );
      }
      await db.insert(workstreams).values({
        id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        ownerId: user.id,
      });
      return { result: { ok: true, id }, workstreamId: id };
    }
    case "RENAME_WORKSTREAM": {
      const p = action.payload;
      await requireWorkstreamInScope(db, p.oldSlug, scope);
      const r = await renameWorkstream(
        p.oldSlug,
        p.newSlug,
        { title: p.title, description: p.description },
        db,
      );
      return { result: { ok: true, ...r }, workstreamId: r.newId };
    }
    case "ADD_PROBLEM": {
      const p = action.payload;
      const ws = await requireWorkstreamInScope(db, p.workstream, scope);
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
      return { result: { ok: true, id }, workstreamId: ws.id };
    }
    case "SCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.id, scope);
      await scheduleProblem(prob.id, p.stage as RoadmapStage, db);
      return {
        result: { ok: true, id: prob.id, status: p.stage },
        workstreamId: prob.workstreamId,
      };
    }
    case "UNSCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.id, scope);
      await unscheduleProblem(prob.id, db);
      return { result: { ok: true, id: prob.id, status: null }, workstreamId: prob.workstreamId };
    }
    case "ABANDON_PROBLEM": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.id, scope);
      await abandonProblem(prob.id, p.rationale, user.id, db);
      return {
        result: { ok: true, id: prob.id, status: "abandoned" },
        workstreamId: prob.workstreamId,
      };
    }
    case "ADD_ATTEMPT": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.problem, scope);
      const n = await countRows("attempts", db);
      const id = `ATT-${String(n + 1).padStart(3, "0")}`;
      await createAttempt(
        { id, problemId: prob.id, ref: p.ref, label: p.label, createdById: user.id },
        db,
      );
      return { result: { ok: true, id }, workstreamId: prob.workstreamId };
    }
    case "CLOSE_ATTEMPT": {
      const p = action.payload;
      const att = await requireAttemptInScope(db, p.id, scope);
      await closeAttempt({ id: p.id, status: p.status, closingNote: p.closingNote }, db);
      // The Attempt row names its Problem, not its Workstream. The lookup is
      // scoped like every other, so a Problem that has gone missing under it
      // leaves the event Workstream-less rather than guessing.
      const attProb = await findProblemInScope(db, att.problemId, scope);
      return {
        result: { ok: true, id: p.id, status: p.status },
        workstreamId: attProb?.workstreamId ?? null,
      };
    }
    case "ADD_OUTCOME": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.problem, scope);
      const n = await countRows("outcomes", db);
      const id = `OUT-${String(n + 1).padStart(3, "0")}`;
      await recordOutcome(
        {
          id,
          problemId: prob.id,
          observedImpact: p.observedImpact,
          learnings: p.learnings,
          // `recordOutcome` refuses a follow-up in a different Workstream, but
          // it says *which* one — which would name another Principal's
          // Workstream back to the caller. Resolving through the scope first
          // makes a foreign follow-up indistinguishable from one that does not
          // exist, in recordOutcome's own words, while a follow-up in another
          // Workstream this Principal owns still gets the accurate mismatch.
          followUpProblemIds: await scopedFollowUps(p.followUpProblemIds, db, scope),
          createdById: user.id,
        },
        db,
      );
      return { result: { ok: true, id, status: "done" }, workstreamId: prob.workstreamId };
    }
    case "ADD_OBSERVATION": {
      const p = action.payload;
      const ws = await requireWorkstreamInScope(db, p.workstream, scope);
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
      return { result: { ok: true, id }, workstreamId: ws.id };
    }
    case "ARCHIVE_OBSERVATION": {
      const p = action.payload;
      const obs = await requireObservationInScope(db, p.id, scope);
      await archiveObservation(p.id, p.rationale ?? "", user.id, db);
      return { result: { ok: true, id: p.id }, workstreamId: obs.workstreamId };
    }
    case "ADD_EVIDENCE": {
      const p = action.payload;
      const prob = await requireProblemInScope(db, p.problem, scope);
      await requireObservationInScope(db, p.observation, scope);
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
      return { result: { ok: true, id }, workstreamId: prob.workstreamId };
    }
    case "RENAME_OBSERVATION": {
      const p = action.payload;
      const obs = await requireObservationInScope(db, p.id, scope);
      await db.update(observations).set({ content: p.content }).where(eq(observations.id, p.id));
      return { result: { ok: true, id: p.id }, workstreamId: obs.workstreamId };
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown mutation kind: ${(_exhaustive as MutationAction).kind}`);
    }
  }
}
