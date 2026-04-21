import { defineCommand } from "citty";
import { getDb } from "@crux/core";
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
  outcomeFollowUpProblems,
  problems,
  solutions,
  themes,
  themeSolutions,
  workstreams,
} from "@crux/core/db/schema";
import { NotFoundError } from "@crux/core/transitions";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

const SEED_VERSION = "2026-04-21";

function legalNextTransitions(lifecycleStatus: string): string[] {
  switch (lifecycleStatus) {
    case "shaping":
      return ["commit", "abandon"];
    case "committed":
      return ["ship", "abandon"];
    case "shipping":
      return ["ship", "abandon"];
    default:
      return [];
  }
}

export const contextCommand = defineCommand({
  meta: {
    name: "context",
    description: "Emit a JSON digest of the workstream for session reload.",
  },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const wsRow = (
      await db.select().from(workstreams).where(eq(workstreams.slug, args.workstream)).limit(1)
    )[0];
    if (!wsRow)
      throw new NotFoundError(`workstream not found: ${args.workstream}`, {
        slug: args.workstream,
      });

    const openProblemsRaw = await db
      .select()
      .from(problems)
      .where(eq(problems.workstreamId, wsRow.id));
    const priorityRank = (tier: string | null): number => {
      switch (tier) {
        case "P0":
          return 0;
        case "P1":
          return 1;
        case "P2":
          return 2;
        case "P3":
          return 3;
        default:
          return 99;
      }
    };
    const openProblems = [...openProblemsRaw].sort((a, b) => {
      const d = priorityRank(a.priorityTier) - priorityRank(b.priorityTier);
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });

    const digestProblems = await Promise.all(
      openProblems.map(async (p) => {
        // Evidence + inlined observation.
        const ev = await db.select().from(evidence).where(eq(evidence.problemId, p.id));
        const obsIds = ev.map((e) => e.observationId);
        const obsRows = obsIds.length
          ? await db.select().from(observations).where(inArray(observations.id, obsIds))
          : [];
        const obsById = new Map(obsRows.map((o) => [o.id, o]));
        const evidenceInlined = ev.map((e) => ({
          ...e,
          observation: obsById.get(e.observationId) ?? null,
        }));

        // Solutions + per-solution outcome.
        const sols = await db.select().from(solutions).where(eq(solutions.problemId, p.id));
        const solIds = sols.map((s) => s.id);
        const outcomeRows = solIds.length
          ? await db.select().from(outcomes).where(inArray(outcomes.solutionId, solIds))
          : [];
        const outcomeBySol = new Map(outcomeRows.map((o) => [o.solutionId, o]));
        // Follow-up problems per outcome.
        const outcomeIds = outcomeRows.map((o) => o.id);
        const followUps = outcomeIds.length
          ? await db
              .select()
              .from(outcomeFollowUpProblems)
              .where(inArray(outcomeFollowUpProblems.outcomeId, outcomeIds))
          : [];
        const followUpsByOutcome = new Map<string, string[]>();
        for (const f of followUps) {
          const list = followUpsByOutcome.get(f.outcomeId) ?? [];
          list.push(f.problemId);
          followUpsByOutcome.set(f.outcomeId, list);
        }
        const solutionsInlined = sols.map((s) => {
          const outcome = outcomeBySol.get(s.id);
          return {
            ...s,
            outcome: outcome
              ? { ...outcome, followUpProblemIds: followUpsByOutcome.get(outcome.id) ?? [] }
              : null,
          };
        });

        // Latest decision.
        const latestDec = (
          await db
            .select()
            .from(decisions)
            .where(eq(decisions.problemId, p.id))
            .orderBy(desc(decisions.createdAt))
            .limit(1)
        )[0];
        let latestDecisionPayload: unknown = null;
        if (latestDec) {
          const rej = await db
            .select({ solutionId: decisionRejectedSolutions.solutionId })
            .from(decisionRejectedSolutions)
            .where(eq(decisionRejectedSolutions.decisionId, latestDec.id));
          latestDecisionPayload = {
            ...latestDec,
            rejectedSolutionIds: rej.map((r) => r.solutionId),
          };
        }

        // Eliminations for this problem + their targeted solutions.
        const elimRows = await db
          .select()
          .from(eliminations)
          .where(eq(eliminations.problemId, p.id));
        const elimIds = elimRows.map((e) => e.id);
        const elimJoins = elimIds.length
          ? await db
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
        const eliminationsInlined = elimRows.map((e) => ({
          ...e,
          eliminatedSolutionIds: targetsByElim.get(e.id) ?? [],
        }));

        // Abandonment (0 or 1).
        const abandonRows = await db
          .select()
          .from(abandonments)
          .where(eq(abandonments.problemId, p.id))
          .limit(1);

        return {
          problem: p,
          evidence: evidenceInlined,
          solutions: solutionsInlined,
          latest_decision: latestDecisionPayload,
          eliminations: eliminationsInlined,
          abandonment: abandonRows[0] ?? null,
          legal_next_transitions: legalNextTransitions(p.lifecycleStatus),
        };
      }),
    );

    // Unlinked observations (no evidence row referencing them, not archived).
    const allWsObs = await db
      .select()
      .from(observations)
      .where(and(eq(observations.workstreamId, wsRow.id), isNull(observations.archivedAt)));
    const linkedObsIds = new Set(
      (await db.select({ id: evidence.observationId }).from(evidence)).map((r) => r.id),
    );
    const unlinked = allWsObs.filter((o) => !linkedObsIds.has(o.id));

    // Unpromoted ideas: ideas in this workstream, not archived, with no Solution referencing them.
    const wsIdeas = await db
      .select()
      .from(ideas)
      .where(and(eq(ideas.workstreamId, wsRow.id), isNull(ideas.archivedAt)));
    const promotedIdeaIds = new Set(
      (await db.select({ ideaId: solutions.originatingIdeaId }).from(solutions))
        .map((r) => r.ideaId)
        .filter((x): x is string => Boolean(x)),
    );
    const unpromotedIdeas = wsIdeas.filter((i) => !promotedIdeaIds.has(i.id));

    // Themes with attached solutions.
    const wsThemes = await db.select().from(themes).where(eq(themes.workstreamId, wsRow.id));
    const themeIds = wsThemes.map((t) => t.id);
    const themeJoins = themeIds.length
      ? await db.select().from(themeSolutions).where(inArray(themeSolutions.themeId, themeIds))
      : [];
    const solByTheme = new Map<string, string[]>();
    for (const j of themeJoins) {
      const list = solByTheme.get(j.themeId) ?? [];
      list.push(j.solutionId);
      solByTheme.set(j.themeId, list);
    }
    const themesInlined = wsThemes.map((t) => ({ ...t, solutionIds: solByTheme.get(t.id) ?? [] }));

    emit({
      workstream: wsRow,
      open_problems: digestProblems,
      recent_observations_unlinked: unlinked,
      unpromoted_ideas: unpromotedIdeas,
      themes: themesInlined,
      seed_version: SEED_VERSION,
    });
  },
});
