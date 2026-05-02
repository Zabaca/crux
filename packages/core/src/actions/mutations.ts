/**
 * runMutation — maps a MutationAction to the appropriate transition call.
 */
import { getDb } from "../db/client.js";
import { requireUser } from "../config/user.js";
import {
  workstreams,
  problems,
  solutions,
  observations,
  eliminations,
  outcomes,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  scheduleProblem,
  unscheduleProblem,
  markProblemDone,
  abandonProblem,
  shipSolution,
  editSolution,
  createElimination,
  createDecision,
  recordOutcome,
  archiveObservation,
  renameWorkstream,
  NotFoundError,
  type RoadmapTier,
} from "../transitions/index.js";
import type { MutationAction } from "./schemas.js";

async function countRows(tableName: "observations" | "eliminations" | "outcomes"): Promise<number> {
  const db = getDb();
  if (tableName === "observations") {
    const rows = await db.select({ id: observations.id }).from(observations);
    const nums = rows.map((r) => Number(r.id.replace(/^OBS-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  if (tableName === "eliminations") {
    const rows = await db.select({ id: eliminations.id }).from(eliminations);
    const nums = rows.map((r) => Number(r.id.replace(/^ELIM-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  if (tableName === "outcomes") {
    const rows = await db.select({ id: outcomes.id }).from(outcomes);
    const nums = rows.map((r) => Number(r.id.replace(/^OUT-/, ""))).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : 0;
  }
  return 0;
}

async function resolveWs(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  if (!rows[0]) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return rows[0];
}

function toIntId(id: string | number): number {
  return typeof id === "number" ? id : parseInt(id, 10);
}

async function resolveProblem(id: string | number) {
  const numId = toIntId(id);
  const rows = await getDb().select().from(problems).where(eq(problems.id, numId)).limit(1);
  if (!rows[0]) throw new NotFoundError(`problem not found: ${id}`, { id });
  return rows[0];
}

async function resolveSolution(id: string | number) {
  const numId = toIntId(id);
  const rows = await getDb().select().from(solutions).where(eq(solutions.id, numId)).limit(1);
  if (!rows[0]) throw new NotFoundError(`solution not found: ${id}`, { id });
  return rows[0];
}

export async function runMutation(action: MutationAction): Promise<unknown> {
  const db = getDb();
  const user = requireUser().user;

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
      const ws = await resolveWs(p.workstream);
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
      const prob = await resolveProblem(p.id);
      await scheduleProblem(prob.id, p.tier as RoadmapTier, db);
      return { ok: true, id: prob.id, status: p.tier };
    }
    case "UNSCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.id);
      await unscheduleProblem(prob.id, db);
      return { ok: true, id: prob.id, status: null };
    }
    case "MARK_PROBLEM_DONE": {
      const p = action.payload;
      const prob = await resolveProblem(p.id);
      await markProblemDone(prob.id, db);
      return { ok: true, id: prob.id, status: "done" };
    }
    case "ABANDON_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.id);
      await abandonProblem(prob.id, p.rationale, user.id, db);
      return { ok: true, id: prob.id, status: "abandoned" };
    }
    case "ADD_SOLUTION": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem);
      const result = await db
        .insert(solutions)
        .values({
          problemId: prob.id,
          title: p.title,
          description: p.description,
          createdById: user.id,
        })
        .returning({ id: solutions.id });
      const id = result[0]!.id;
      return { ok: true, id };
    }
    case "SHIP_SOLUTION": {
      const p = action.payload;
      const sol = await resolveSolution(p.id);
      await shipSolution(sol.id, db);
      return { ok: true, id: sol.id, status: "shipped" };
    }
    case "EDIT_SOLUTION": {
      const { solutionId, description, title } = action.payload;
      const numId = toIntId(solutionId);
      await editSolution(numId, { description, title }, db);
      return { ok: true, id: numId };
    }
    case "ADD_DECISION": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem);
      const chosenSol = await resolveSolution(p.chosen);
      const rejectedIds = p.rejected
        ? await Promise.all(p.rejected.map((s) => resolveSolution(s).then((r) => r.id)))
        : [];
      const decisionCount = (
        await db
          .select({ id: (await import("../db/schema.js")).decisions.id })
          .from((await import("../db/schema.js")).decisions)
          .where(eq((await import("../db/schema.js")).decisions.problemId, prob.id))
      ).length;
      const id = `DEC-${String(decisionCount + 1).padStart(3, "0")}`;
      const decId = await createDecision(
        {
          id,
          problemId: prob.id,
          chosenSolutionId: chosenSol.id,
          rationale: p.rationale,
          rejectedSolutionIds: rejectedIds,
          decidedById: user.id,
        },
        db,
      );
      return { ok: true, id: decId };
    }
    case "ADD_OUTCOME": {
      const p = action.payload;
      const sol = await resolveSolution(p.solution);
      const n = await countRows("outcomes");
      const id = `OUT-${String(n + 1).padStart(3, "0")}`;
      await recordOutcome(
        {
          id,
          solutionId: sol.id,
          observedImpact: p.summary,
          followUpProblemIds: p.followUpProblemIds ? p.followUpProblemIds.map(toIntId) : [],
          createdById: user.id,
        },
        db,
      );
      return { ok: true, id };
    }
    case "ADD_OBSERVATION": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream);
      const n = await countRows("observations");
      const id = `OBS-${String(n + 1).padStart(3, "0")}`;
      await db.insert(observations).values({
        id,
        workstreamId: ws.id,
        reporterId: user.id,
        content: p.content,
        source: p.source,
      });
      return { ok: true, id };
    }
    case "ARCHIVE_OBSERVATION": {
      const p = action.payload;
      await archiveObservation(p.id, "", user.id, db);
      return { ok: true, id: p.id };
    }
    case "ADD_EVIDENCE": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem);
      const obsRows = await db
        .select()
        .from(observations)
        .where(eq(observations.id, p.observation))
        .limit(1);
      if (!obsRows[0])
        throw new NotFoundError(`observation not found: ${p.observation}`, { id: p.observation });
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
    case "ADD_ELIMINATION": {
      const p = action.payload;
      const sol = await resolveSolution(p.solution);
      const n = await countRows("eliminations");
      const id = `ELIM-${String(n + 1).padStart(3, "0")}`;
      await createElimination(
        {
          id,
          problemId: sol.problemId,
          eliminatedSolutionIds: [sol.id],
          rationale: p.rationale,
          eliminatedById: user.id,
        },
        db,
      );
      return { ok: true, id };
    }
    case "RENAME_OBSERVATION": {
      const p = action.payload;
      const obsRows = await db
        .select()
        .from(observations)
        .where(eq(observations.id, p.id))
        .limit(1);
      if (!obsRows[0]) throw new NotFoundError(`observation not found: ${p.id}`, { id: p.id });
      await db.update(observations).set({ content: p.content }).where(eq(observations.id, p.id));
      return { ok: true, id: p.id };
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown mutation kind: ${(_exhaustive as MutationAction).kind}`);
    }
  }
}
