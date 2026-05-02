import { getDb } from "@crux/core";
import {
  abandonments,
  decisionRejectedSolutions,
  decisions,
  eliminations,
  eliminationSolutions,
  evidence,
  observations,
  outcomes,
  outcomeFollowUpProblems,
  problems,
  solutions,
  workstreams,
} from "@crux/core/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

/**
 * Read-only query layer for the TUI (`crux browse`).
 */

export type ArchiveBlock = {
  rationale: string | null;
  archivedById: string | null;
  archivedAt: number;
} | null;

export type Workstream = typeof workstreams.$inferSelect;
export type Problem = typeof problems.$inferSelect;
export type Observation = typeof observations.$inferSelect & { archive: ArchiveBlock };
export type Solution = typeof solutions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Decision = typeof decisions.$inferSelect & { rejectedSolutionIds: number[] };
export type Elimination = typeof eliminations.$inferSelect & { eliminatedSolutionIds: number[] };
export type Abandonment = typeof abandonments.$inferSelect;
export type Outcome = typeof outcomes.$inferSelect & { followUpProblemIds: number[] };

const STATUS_RANK: Record<string, number> = {
  now: 0,
  next: 1,
  later: 2,
  done: 4,
  abandoned: 5,
};
const rankStatus = (s: string | null): number => (s == null ? 3 : (STATUS_RANK[s] ?? 99));

const SOLUTION_STATUS_RANK: Record<string, number> = {
  chosen: 0,
  shipped: 1,
  evaluated: 2,
  proposed: 3,
  rejected: 4,
};

function toArchive(row: {
  archivedAt: number | null;
  archiveRationale: string | null;
  archivedById: string | null;
}): ArchiveBlock {
  return row.archivedAt
    ? {
        rationale: row.archiveRationale,
        archivedById: row.archivedById,
        archivedAt: row.archivedAt,
      }
    : null;
}

export async function listWorkstreams() {
  const db = getDb();
  const wsRows = await db.select().from(workstreams);
  const allProblems = await db.select().from(problems);
  const openByWs = new Map<string, number>();
  for (const p of allProblems) {
    if (p.status !== "done" && p.status !== "abandoned") {
      openByWs.set(p.workstreamId, (openByWs.get(p.workstreamId) ?? 0) + 1);
    }
  }
  return wsRows.map((w) => ({ ...w, openProblemCount: openByWs.get(w.id) ?? 0 }));
}

export async function getWorkstreamBySlug(slug: string): Promise<Workstream | null> {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export type ProblemSummary = Problem & { evidenceCount: number; solutionCount: number };

export async function listOpenProblems(workstreamId: string): Promise<ProblemSummary[]> {
  const db = getDb();
  const rows = await db.select().from(problems).where(eq(problems.workstreamId, workstreamId));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const ev = await db
    .select({ problemId: evidence.problemId })
    .from(evidence)
    .where(inArray(evidence.problemId, ids));
  const sol = await db
    .select({ problemId: solutions.problemId })
    .from(solutions)
    .where(inArray(solutions.problemId, ids));
  const evCount = new Map<number, number>();
  for (const e of ev) evCount.set(e.problemId, (evCount.get(e.problemId) ?? 0) + 1);
  const solCount = new Map<number, number>();
  for (const s of sol) solCount.set(s.problemId, (solCount.get(s.problemId) ?? 0) + 1);

  return rows
    .map((r) => ({
      ...r,
      evidenceCount: evCount.get(r.id) ?? 0,
      solutionCount: solCount.get(r.id) ?? 0,
    }))
    .sort((a, b) => {
      const d = rankStatus(a.status) - rankStatus(b.status);
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });
}

export async function getProblemById(id: number): Promise<Problem | null> {
  const rows = await getDb().select().from(problems).where(eq(problems.id, id)).limit(1);
  return rows[0] ?? null;
}

export type ProblemDetail = {
  problem: Problem;
  evidence: Array<Evidence & { observation: Observation | null }>;
  solutions: Array<Solution & { outcome: Outcome | null }>;
  latestDecision: Decision | null;
  eliminations: Elimination[];
  abandonment: Abandonment | null;
};

export async function getProblemDetail(problemId: number): Promise<ProblemDetail | null> {
  const db = getDb();
  const p = await getProblemById(problemId);
  if (!p) return null;

  const evRows = await db.select().from(evidence).where(eq(evidence.problemId, problemId));
  evRows.sort((a, b) => a.createdAt - b.createdAt);
  const obsIds = evRows.map((e) => e.observationId);
  const obsRows = obsIds.length
    ? await db.select().from(observations).where(inArray(observations.id, obsIds))
    : [];
  const obsById = new Map(obsRows.map((o) => [o.id, { ...o, archive: toArchive(o) }]));
  const evidenceInlined = evRows.map((e) => ({
    ...e,
    observation: obsById.get(e.observationId) ?? null,
  }));

  const sols = await db.select().from(solutions).where(eq(solutions.problemId, problemId));
  const solIds = sols.map((s) => s.id);
  const outcomeRows = solIds.length
    ? await db.select().from(outcomes).where(inArray(outcomes.solutionId, solIds))
    : [];
  const followUpIds = outcomeRows.map((o) => o.id);
  const followUps = followUpIds.length
    ? await db
        .select()
        .from(outcomeFollowUpProblems)
        .where(inArray(outcomeFollowUpProblems.outcomeId, followUpIds))
    : [];
  const followUpsByOutcome = new Map<string, number[]>();
  for (const f of followUps) {
    const list = followUpsByOutcome.get(f.outcomeId) ?? [];
    list.push(f.problemId);
    followUpsByOutcome.set(f.outcomeId, list);
  }
  const outcomeBySol = new Map(
    outcomeRows.map((o) => [
      o.solutionId,
      { ...o, followUpProblemIds: followUpsByOutcome.get(o.id) ?? [] },
    ]),
  );
  const solutionsInlined = sols
    .map((s) => ({ ...s, outcome: outcomeBySol.get(s.id) ?? null }))
    .sort((a, b) => {
      const d = (SOLUTION_STATUS_RANK[a.status] ?? 9) - (SOLUTION_STATUS_RANK[b.status] ?? 9);
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });

  const decRow = (
    await db
      .select()
      .from(decisions)
      .where(eq(decisions.problemId, problemId))
      .orderBy(desc(decisions.createdAt))
      .limit(1)
  )[0];
  let latestDecision: Decision | null = null;
  if (decRow) {
    const rej = await db
      .select({ solutionId: decisionRejectedSolutions.solutionId })
      .from(decisionRejectedSolutions)
      .where(eq(decisionRejectedSolutions.decisionId, decRow.id));
    latestDecision = { ...decRow, rejectedSolutionIds: rej.map((r) => r.solutionId) };
  }

  const elimRows = await db
    .select()
    .from(eliminations)
    .where(eq(eliminations.problemId, problemId));
  const elimIds = elimRows.map((e) => e.id);
  const elimTargets = elimIds.length
    ? await db
        .select()
        .from(eliminationSolutions)
        .where(inArray(eliminationSolutions.eliminationId, elimIds))
    : [];
  const targetsByElim = new Map<string, number[]>();
  for (const t of elimTargets) {
    const list = targetsByElim.get(t.eliminationId) ?? [];
    list.push(t.solutionId);
    targetsByElim.set(t.eliminationId, list);
  }
  const eliminationsInlined = elimRows.map((e) => ({
    ...e,
    eliminatedSolutionIds: targetsByElim.get(e.id) ?? [],
  }));

  const abandonRow = (
    await db.select().from(abandonments).where(eq(abandonments.problemId, problemId)).limit(1)
  )[0];

  return {
    problem: p,
    evidence: evidenceInlined,
    solutions: solutionsInlined,
    latestDecision,
    eliminations: eliminationsInlined,
    abandonment: abandonRow ?? null,
  };
}

export type SolutionDetail = {
  solution: Solution;
  problem: Problem;
  choosingDecision: Decision | null;
  rejectingDecision: Decision | null;
  eliminatedBy: Elimination[];
  outcome: Outcome | null;
};

export async function getSolutionById(id: number): Promise<Solution | null> {
  const rows = await getDb().select().from(solutions).where(eq(solutions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getSolutionDetail(solutionId: number): Promise<SolutionDetail | null> {
  const db = getDb();
  const sRows = await db.select().from(solutions).where(eq(solutions.id, solutionId)).limit(1);
  const s = sRows[0];
  if (!s) return null;
  const pr = await getProblemById(s.problemId);
  if (!pr) return null;

  const allDec = await db
    .select()
    .from(decisions)
    .where(eq(decisions.problemId, pr.id))
    .orderBy(desc(decisions.createdAt));

  let choosingDecision: Decision | null = null;
  let rejectingDecision: Decision | null = null;
  for (const d of allDec) {
    if (d.chosenSolutionId === solutionId && !choosingDecision) {
      const rej = await db
        .select({ solutionId: decisionRejectedSolutions.solutionId })
        .from(decisionRejectedSolutions)
        .where(eq(decisionRejectedSolutions.decisionId, d.id));
      choosingDecision = { ...d, rejectedSolutionIds: rej.map((r) => r.solutionId) };
    }
    if (!rejectingDecision) {
      const rej = await db
        .select({ solutionId: decisionRejectedSolutions.solutionId })
        .from(decisionRejectedSolutions)
        .where(eq(decisionRejectedSolutions.decisionId, d.id));
      if (rej.some((r) => r.solutionId === solutionId)) {
        rejectingDecision = { ...d, rejectedSolutionIds: rej.map((r) => r.solutionId) };
      }
    }
  }

  const elimJoins = await db
    .select()
    .from(eliminationSolutions)
    .where(eq(eliminationSolutions.solutionId, solutionId));
  const elimIds = elimJoins.map((e) => e.eliminationId);
  const elimRows = elimIds.length
    ? await db.select().from(eliminations).where(inArray(eliminations.id, elimIds))
    : [];
  const allTargets = elimIds.length
    ? await db
        .select()
        .from(eliminationSolutions)
        .where(inArray(eliminationSolutions.eliminationId, elimIds))
    : [];
  const targetsByElim = new Map<string, number[]>();
  for (const t of allTargets) {
    const list = targetsByElim.get(t.eliminationId) ?? [];
    list.push(t.solutionId);
    targetsByElim.set(t.eliminationId, list);
  }
  const eliminatedBy = elimRows.map((e) => ({
    ...e,
    eliminatedSolutionIds: targetsByElim.get(e.id) ?? [],
  }));

  const outRows = await db
    .select()
    .from(outcomes)
    .where(eq(outcomes.solutionId, solutionId))
    .limit(1);
  let outcome: Outcome | null = null;
  if (outRows[0]) {
    const fu = await db
      .select()
      .from(outcomeFollowUpProblems)
      .where(eq(outcomeFollowUpProblems.outcomeId, outRows[0].id));
    outcome = { ...outRows[0], followUpProblemIds: fu.map((f) => f.problemId) };
  }

  return { solution: s, problem: pr, choosingDecision, rejectingDecision, eliminatedBy, outcome };
}

export type ObservationDetail = {
  observation: Observation;
  evidenceLinks: Array<Evidence & { problem: Problem }>;
};

export async function getObservationById(id: string): Promise<Observation | null> {
  const rows = await getDb().select().from(observations).where(eq(observations.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return { ...r, archive: toArchive(r) };
}

export async function getObservationDetail(id: string): Promise<ObservationDetail | null> {
  const db = getDb();
  const obs = await getObservationById(id);
  if (!obs) return null;
  const evRows = await db.select().from(evidence).where(eq(evidence.observationId, id));
  const probIds = evRows.map((e) => e.problemId);
  const probRows = probIds.length
    ? await db.select().from(problems).where(inArray(problems.id, probIds))
    : [];
  const probById = new Map(probRows.map((p) => [p.id, p]));
  const evidenceLinks = evRows
    .map((e) => ({ ...e, problem: probById.get(e.problemId)! }))
    .filter((e) => e.problem);
  return { observation: obs, evidenceLinks };
}

export async function listUnlinkedObservations(
  workstreamId: string,
  showArchived: boolean,
): Promise<Observation[]> {
  const db = getDb();
  const where = showArchived
    ? eq(observations.workstreamId, workstreamId)
    : and(eq(observations.workstreamId, workstreamId), isNull(observations.archivedAt));
  const allObs = await db.select().from(observations).where(where);
  const linked = new Set(
    (await db.select({ id: evidence.observationId }).from(evidence)).map((r) => r.id),
  );
  return allObs
    .filter((o) => !linked.has(o.id))
    .map((o) => ({ ...o, archive: toArchive(o) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSolutionsByIds(ids: number[]): Promise<Solution[]> {
  if (ids.length === 0) return [];
  return getDb().select().from(solutions).where(inArray(solutions.id, ids));
}
