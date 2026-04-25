import "server-only";
import {
  abandonments,
  decisionRejectedSolutions,
  decisions,
  eliminations,
  eliminationSolutions,
  evidence,
  ideas,
  observations,
  outcomes,
  problems,
  solutions,
  themes,
  workstreams,
} from "@crux/core/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import { priorityRank, solutionStatusRank } from "./sort";

export type Workstream = typeof workstreams.$inferSelect;
export type Problem = typeof problems.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type Solution = typeof solutions.$inferSelect;
export type Evidence = typeof evidence.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type Elimination = typeof eliminations.$inferSelect;
export type Abandonment = typeof abandonments.$inferSelect;
export type Outcome = typeof outcomes.$inferSelect;

export async function listWorkstreams() {
  const d = db();
  const wss = await d.select().from(workstreams).orderBy(workstreams.title);
  // Per-workstream open-problem count.
  const counts = await Promise.all(
    wss.map(async (ws) => {
      const probs = await d
        .select({ id: problems.id, lifecycleStatus: problems.lifecycleStatus })
        .from(problems)
        .where(eq(problems.workstreamId, ws.id));
      const open = probs.filter(
        (p) => p.lifecycleStatus !== "shipped" && p.lifecycleStatus !== "abandoned",
      ).length;
      return { workstream: ws, openProblemCount: open, totalProblemCount: probs.length };
    }),
  );
  return counts;
}

export async function getWorkstreamBySlug(slug: string) {
  const d = db();
  const row = (await d.select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1))[0];
  return row ?? null;
}

/** Workstream dashboard: all problems sorted as the spec defines. */
export async function getWorkstreamProblems(workstreamId: string) {
  const d = db();
  const rows = await d.select().from(problems).where(eq(problems.workstreamId, workstreamId));
  // Annotate with evidence count and solution count.
  const ids = rows.map((p) => p.id);
  if (!ids.length) return [];
  const [evRows, solRows] = await Promise.all([
    d
      .select({ problemId: evidence.problemId, observationId: evidence.observationId })
      .from(evidence)
      .where(inArray(evidence.problemId, ids)),
    d
      .select({ problemId: solutions.problemId, id: solutions.id })
      .from(solutions)
      .where(inArray(solutions.problemId, ids)),
  ]);
  const evCountByProblem = new Map<string, number>();
  for (const r of evRows) {
    evCountByProblem.set(r.problemId, (evCountByProblem.get(r.problemId) ?? 0) + 1);
  }
  const solCountByProblem = new Map<string, number>();
  for (const r of solRows) {
    solCountByProblem.set(r.problemId, (solCountByProblem.get(r.problemId) ?? 0) + 1);
  }
  const annotated = rows.map((p) => ({
    ...p,
    evidenceCount: evCountByProblem.get(p.id) ?? 0,
    solutionCount: solCountByProblem.get(p.id) ?? 0,
  }));
  annotated.sort((a, b) => {
    const d = priorityRank(a.priorityTier) - priorityRank(b.priorityTier);
    if (d !== 0) return d;
    return a.createdAt - b.createdAt;
  });
  return annotated;
}

export type ObservationWithArchive = Observation & {
  archive: { rationale: string | null; archivedById: string | null; archivedAt: number } | null;
};

function withArchive<
  T extends {
    archivedAt: number | null;
    archiveRationale: string | null;
    archivedById: string | null;
  },
>(
  o: T,
): T & {
  archive: { rationale: string | null; archivedById: string | null; archivedAt: number } | null;
} {
  return {
    ...o,
    archive: o.archivedAt
      ? {
          rationale: o.archiveRationale,
          archivedById: o.archivedById,
          archivedAt: o.archivedAt,
        }
      : null,
  };
}

export type ProblemDetail = {
  problem: Problem;
  workstream: Workstream;
  evidence: Array<Evidence & { observation: ObservationWithArchive | null }>;
  solutions: Array<Solution & { outcome: Outcome | null }>;
  latestDecision:
    | (Decision & {
        rejectedSolutionIds: string[];
        chosenSolutionSlug: string | null;
        rejectedSolutionSlugs: string[];
      })
    | null;
  eliminations: Array<
    Elimination & { eliminatedSolutionIds: string[]; eliminatedSolutionSlugs: string[] }
  >;
  abandonment: Abandonment | null;
  outcomes: Array<Outcome & { solutionSlug: string }>;
};

export async function getProblemBySlug(
  workstreamId: string,
  problemSlug: string,
): Promise<ProblemDetail | null> {
  const d = db();
  const p = (
    await d
      .select()
      .from(problems)
      .where(and(eq(problems.workstreamId, workstreamId), eq(problems.slug, problemSlug)))
      .limit(1)
  )[0];
  if (!p) return null;
  const ws = (
    await d.select().from(workstreams).where(eq(workstreams.id, workstreamId)).limit(1)
  )[0];
  if (!ws) return null;

  const evRows = await d.select().from(evidence).where(eq(evidence.problemId, p.id));
  evRows.sort((a, b) => a.createdAt - b.createdAt);
  const obsIds = evRows.map((e) => e.observationId);
  const obsRows = obsIds.length
    ? await d.select().from(observations).where(inArray(observations.id, obsIds))
    : [];
  const obsById = new Map(obsRows.map((o) => [o.id, withArchive(o)]));
  const evidenceInlined = evRows.map((e) => ({
    ...e,
    observation: obsById.get(e.observationId) ?? null,
  }));

  const solRows = await d.select().from(solutions).where(eq(solutions.problemId, p.id));
  const solIds = solRows.map((s) => s.id);
  const outcomeRows = solIds.length
    ? await d.select().from(outcomes).where(inArray(outcomes.solutionId, solIds))
    : [];
  const outcomeBySol = new Map(outcomeRows.map((o) => [o.solutionId, o]));
  const solutionsInlined = solRows
    .map((s) => ({ ...s, outcome: outcomeBySol.get(s.id) ?? null }))
    .sort((a, b) => {
      const d = solutionStatusRank(a.status) - solutionStatusRank(b.status);
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });
  const slugBySolId = new Map(solRows.map((s) => [s.id, s.slug]));

  const latestDec = (
    await d
      .select()
      .from(decisions)
      .where(eq(decisions.problemId, p.id))
      .orderBy(desc(decisions.createdAt))
      .limit(1)
  )[0];
  let latestDecisionPayload: ProblemDetail["latestDecision"] = null;
  if (latestDec) {
    const rej = await d
      .select({ solutionId: decisionRejectedSolutions.solutionId })
      .from(decisionRejectedSolutions)
      .where(eq(decisionRejectedSolutions.decisionId, latestDec.id));
    const rejectedIds = rej.map((r) => r.solutionId);
    latestDecisionPayload = {
      ...latestDec,
      rejectedSolutionIds: rejectedIds,
      chosenSolutionSlug: slugBySolId.get(latestDec.chosenSolutionId) ?? null,
      rejectedSolutionSlugs: rejectedIds
        .map((id) => slugBySolId.get(id) ?? null)
        .filter((s): s is string => Boolean(s)),
    };
  }

  const elimRows = await d.select().from(eliminations).where(eq(eliminations.problemId, p.id));
  elimRows.sort((a, b) => a.createdAt - b.createdAt);
  const elimIds = elimRows.map((e) => e.id);
  const elimJoins = elimIds.length
    ? await d
        .select()
        .from(eliminationSolutions)
        .where(inArray(eliminationSolutions.eliminationId, elimIds))
    : [];
  const targetsByElim = new Map<string, string[]>();
  for (const j of elimJoins) {
    const list = targetsByElim.get(j.eliminationId) ?? [];
    list.push(j.solutionId);
    targetsByElim.set(j.eliminationId, list);
  }
  const eliminationsInlined = elimRows.map((e) => {
    const ids = targetsByElim.get(e.id) ?? [];
    return {
      ...e,
      eliminatedSolutionIds: ids,
      eliminatedSolutionSlugs: ids
        .map((id) => slugBySolId.get(id) ?? null)
        .filter((s): s is string => Boolean(s)),
    };
  });

  const abandonRow = (
    await d.select().from(abandonments).where(eq(abandonments.problemId, p.id)).limit(1)
  )[0];

  const outcomesWithSlug = outcomeRows.map((o) => ({
    ...o,
    solutionSlug: slugBySolId.get(o.solutionId) ?? "",
  }));

  return {
    problem: p,
    workstream: ws,
    evidence: evidenceInlined,
    solutions: solutionsInlined,
    latestDecision: latestDecisionPayload,
    eliminations: eliminationsInlined,
    abandonment: abandonRow ?? null,
    outcomes: outcomesWithSlug,
  };
}

export async function getSolutionBySlug(workstreamSlug: string, solutionSlug: string) {
  const d = db();
  const s = (await d.select().from(solutions).where(eq(solutions.slug, solutionSlug)).limit(1))[0];
  if (!s) return null;
  const p = (await d.select().from(problems).where(eq(problems.id, s.problemId)).limit(1))[0];
  if (!p) return null;
  const ws = (
    await d.select().from(workstreams).where(eq(workstreams.id, p.workstreamId)).limit(1)
  )[0];
  if (!ws || ws.slug !== workstreamSlug) return null;

  // Decisions touching this solution: chosen or rejected.
  const allDecsForProblem = await d.select().from(decisions).where(eq(decisions.problemId, p.id));
  const decIds = allDecsForProblem.map((d) => d.id);
  const rejJoins = decIds.length
    ? await d
        .select()
        .from(decisionRejectedSolutions)
        .where(inArray(decisionRejectedSolutions.decisionId, decIds))
    : [];
  const rejByDec = new Map<string, string[]>();
  for (const j of rejJoins) {
    const list = rejByDec.get(j.decisionId) ?? [];
    list.push(j.solutionId);
    rejByDec.set(j.decisionId, list);
  }
  const choosingDecisions = allDecsForProblem.filter((d) => d.chosenSolutionId === s.id);
  const rejectingDecisions = allDecsForProblem.filter((d) =>
    (rejByDec.get(d.id) ?? []).includes(s.id),
  );

  // Eliminations touching this solution.
  const allElimsForProblem = await d
    .select()
    .from(eliminations)
    .where(eq(eliminations.problemId, p.id));
  const elimIds = allElimsForProblem.map((e) => e.id);
  const elimJoins = elimIds.length
    ? await d
        .select()
        .from(eliminationSolutions)
        .where(inArray(eliminationSolutions.eliminationId, elimIds))
    : [];
  const elimsTouching = allElimsForProblem.filter((e) =>
    elimJoins.some((j) => j.eliminationId === e.id && j.solutionId === s.id),
  );

  // Outcome.
  const outcome = (
    await d.select().from(outcomes).where(eq(outcomes.solutionId, s.id)).limit(1)
  )[0];

  // Originating idea (if any).
  let originatingIdea = null;
  if (s.originatingIdeaId) {
    originatingIdea =
      (await d.select().from(ideas).where(eq(ideas.id, s.originatingIdeaId)).limit(1))[0] ?? null;
  }

  return {
    solution: s,
    problem: p,
    workstream: ws,
    choosingDecisions,
    rejectingDecisions,
    eliminations: elimsTouching,
    outcome: outcome ?? null,
    originatingIdea,
  };
}

export async function getObservationById(workstreamSlug: string, obsId: string) {
  const d = db();
  const obs = (await d.select().from(observations).where(eq(observations.id, obsId)).limit(1))[0];
  if (!obs) return null;
  const ws = (
    await d.select().from(workstreams).where(eq(workstreams.id, obs.workstreamId)).limit(1)
  )[0];
  if (!ws || ws.slug !== workstreamSlug) return null;

  const evRows = await d.select().from(evidence).where(eq(evidence.observationId, obs.id));
  const probIds = evRows.map((e) => e.problemId);
  const probs = probIds.length
    ? await d.select().from(problems).where(inArray(problems.id, probIds))
    : [];
  const probById = new Map(probs.map((p) => [p.id, p]));
  const linkedProblems = evRows.map((e) => ({
    evidence: e,
    problem: probById.get(e.problemId) ?? null,
  }));

  return {
    observation: withArchive(obs),
    workstream: ws,
    linkedProblems,
  };
}

export async function getUnlinkedObservations(workstreamId: string, showArchived: boolean) {
  const d = db();
  const all = await d
    .select()
    .from(observations)
    .where(
      showArchived
        ? eq(observations.workstreamId, workstreamId)
        : and(eq(observations.workstreamId, workstreamId), isNull(observations.archivedAt)),
    );
  const linkedIds = new Set(
    (await d.select({ id: evidence.observationId }).from(evidence)).map((r) => r.id),
  );
  const unlinked = all.filter((o) => !linkedIds.has(o.id)).map(withArchive);
  unlinked.sort((a, b) => b.createdAt - a.createdAt);
  return unlinked;
}

export async function getUnpromotedIdeas(workstreamId: string, showArchived: boolean) {
  const d = db();
  const wsIdeas = await d
    .select()
    .from(ideas)
    .where(
      showArchived
        ? eq(ideas.workstreamId, workstreamId)
        : and(eq(ideas.workstreamId, workstreamId), isNull(ideas.archivedAt)),
    );
  const promoted = new Set(
    (await d.select({ ideaId: solutions.originatingIdeaId }).from(solutions))
      .map((r) => r.ideaId)
      .filter((x): x is string => Boolean(x)),
  );
  const unpromoted = wsIdeas.filter((i) => !promoted.has(i.id)).map(withArchive);
  unpromoted.sort((a, b) => b.createdAt - a.createdAt);
  return unpromoted;
}

export async function getThemes(workstreamId: string) {
  const d = db();
  return await d.select().from(themes).where(eq(themes.workstreamId, workstreamId));
}
