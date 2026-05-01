/**
 * runMutation — maps a MutationAction to the appropriate transition call.
 *
 * This is intentionally a thin dispatcher: it resolves slugs to IDs,
 * calls the existing transitions (unchanged), and returns a result shape.
 * No business logic lives here.
 */
import { getDb } from "../db/client.js";
import { requireUser } from "../config/user.js";
import {
  workstreams,
  problems,
  solutions,
  observations,
  ideas,
  themes,
  eliminations,
  eliminationSolutions,
  outcomes,
  outcomeFollowUpProblems,
} from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import {
  scheduleProblem,
  unscheduleProblem,
  markProblemDone,
  abandonProblem,
  shipSolution,
  createElimination,
  createDecision,
  recordOutcome,
  archiveObservation,
  archiveIdea,
  renameWorkstream,
  renameProblem,
  renameSolution,
  NotFoundError,
  type RoadmapTier,
} from "../transitions/index.js";
import type { MutationAction } from "./schemas.js";

function nextId(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

async function nextSequentialId(
  table: { id: ReturnType<typeof eq> },
  prefix: string,
): Promise<string> {
  // We count rows in a table to get next numeric id
  void table;
  void prefix;
  throw new Error("use nextObsId/nextEliminationId instead");
}
void nextSequentialId;
void nextId;

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

async function resolveProblem(slug: string) {
  const rows = await getDb().select().from(problems).where(eq(problems.slug, slug)).limit(1);
  if (!rows[0]) throw new NotFoundError(`problem not found: ${slug}`, { slug });
  return rows[0];
}

async function resolveSolution(slug: string) {
  const rows = await getDb().select().from(solutions).where(eq(solutions.slug, slug)).limit(1);
  if (!rows[0]) throw new NotFoundError(`solution not found: ${slug}`, { slug });
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
      const id = `PRB-${p.slug}`;
      await db.insert(problems).values({
        id,
        slug: p.slug,
        workstreamId: ws.id,
        title: p.title,
        description: p.description,
        createdById: user.id,
      });
      return { ok: true, id };
    }
    case "SCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.slug);
      await scheduleProblem(prob.id, p.tier as RoadmapTier, db);
      return { ok: true, id: prob.id, status: p.tier };
    }
    case "UNSCHEDULE_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.slug);
      await unscheduleProblem(prob.id, db);
      return { ok: true, id: prob.id, status: null };
    }
    case "MARK_PROBLEM_DONE": {
      const p = action.payload;
      const prob = await resolveProblem(p.slug);
      await markProblemDone(prob.id, db);
      return { ok: true, id: prob.id, status: "done" };
    }
    case "ABANDON_PROBLEM": {
      const p = action.payload;
      const prob = await resolveProblem(p.slug);
      await abandonProblem(prob.id, p.rationale, user.id, db);
      return { ok: true, id: prob.id, status: "abandoned" };
    }
    case "RENAME_PROBLEM": {
      const p = action.payload;
      const r = await renameProblem(
        p.oldSlug,
        p.newSlug,
        { title: p.title, description: p.description },
        db,
      );
      return { ok: true, ...r };
    }
    case "ADD_SOLUTION": {
      const p = action.payload;
      const prob = await resolveProblem(p.problem);
      const id = `SOL-${p.slug}`;
      await db.insert(solutions).values({
        id,
        slug: p.slug,
        problemId: prob.id,
        title: p.title,
        description: p.description,
        createdById: user.id,
      });
      return { ok: true, id };
    }
    case "SHIP_SOLUTION": {
      const p = action.payload;
      const sol = await resolveSolution(p.slug);
      await shipSolution(sol.id, db);
      return { ok: true, id: sol.id, status: "shipped" };
    }
    case "RENAME_SOLUTION": {
      const p = action.payload;
      const r = await renameSolution(
        p.oldSlug,
        p.newSlug,
        { title: p.title, description: p.description },
        db,
      );
      return { ok: true, ...r };
    }
    case "PROMOTE_IDEA": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream);
      const ideaRows = await db
        .select()
        .from(ideas)
        .where(and(eq(ideas.workstreamId, ws.id), eq(ideas.slug, p.slug)))
        .limit(1);
      if (!ideaRows[0]) throw new NotFoundError(`idea not found: ${p.slug}`, { slug: p.slug });
      const prob = await resolveProblem(p.problem);
      const { slugifyName } = await import("../config/user.js");
      const solutionSlug = slugifyName(p.title);
      const id = `SOL-${solutionSlug}`;
      await db.insert(solutions).values({
        id,
        slug: solutionSlug,
        problemId: prob.id,
        title: p.title,
        originatingIdeaId: ideaRows[0].id,
        createdById: user.id,
      });
      return { ok: true, id, originatingIdeaId: ideaRows[0].id };
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
          createdById: user.id,
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
          followUpProblemIds: p.followUpProblemIds ?? [],
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
    case "ADD_IDEA": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream);
      const id = `IDEA-${p.slug}`;
      await db.insert(ideas).values({
        id,
        slug: p.slug,
        workstreamId: ws.id,
        reporterId: user.id,
        title: p.title,
        description: p.description,
      });
      return { ok: true, id };
    }
    case "ARCHIVE_IDEA": {
      const p = action.payload;
      // Need workstream context — try to find idea by slug across all workstreams
      const ideaRows = await db.select().from(ideas).where(eq(ideas.slug, p.slug)).limit(1);
      if (!ideaRows[0]) throw new NotFoundError(`idea not found: ${p.slug}`, { slug: p.slug });
      const { id } = await archiveIdea(ideaRows[0].workstreamId, p.slug, "", user.id, db);
      return { ok: true, id };
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
        linkedById: user.id,
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
    case "ADD_THEME": {
      const p = action.payload;
      const ws = await resolveWs(p.workstream);
      const id = `THM-${p.slug}`;
      await db.insert(themes).values({
        id,
        slug: p.slug,
        workstreamId: ws.id,
        title: p.title,
        createdById: user.id,
      });
      return { ok: true, id };
    }
    case "ATTACH_THEME": {
      const p = action.payload;
      const themeRows = await db.select().from(themes).where(eq(themes.slug, p.theme)).limit(1);
      if (!themeRows[0]) throw new NotFoundError(`theme not found: ${p.theme}`, { slug: p.theme });
      const sol = await resolveSolution(p.solution);
      const { themeSolutions } = await import("../db/schema.js");
      await db.insert(themeSolutions).values({ themeId: themeRows[0].id, solutionId: sol.id });
      return { ok: true, themeId: themeRows[0].id, solutionId: sol.id };
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
