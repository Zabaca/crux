import { defineCommand } from "citty";
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
import { NotFoundError } from "@crux/core/transitions";
import { ContextOutput } from "@crux/core/validation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { recordQuery } from "../record-query.js";
import { wsArg, hintCtx } from "../ctx-defaults.js";

const SEED_VERSION = "2026-04-21";

function legalNextTransitions(status: string | null, hasShippedSolution: boolean): string[] {
  if (status === "done" || status === "abandoned") return [];
  const events: string[] = ["schedule", "abandon"];
  if (status !== null) events.push("unschedule");
  if (hasShippedSolution) events.push("done");
  return events;
}

const STATUS_RANK: Record<string, number> = {
  now: 0,
  next: 1,
  later: 2,
  done: 4,
  abandoned: 5,
};
const rankStatus = (s: string | null): number => (s == null ? 3 : (STATUS_RANK[s] ?? 99));

export const contextCommand = defineCommand({
  meta: {
    name: "context",
    description: "Emit a JSON digest of the workstream for session reload.",
  },
  args: {
    workstream: { type: "string", required: false, alias: "w" },
    "show-archived": {
      type: "boolean",
      description: "Include archived Observations in the unlinked-observations section.",
    },
    tier: {
      type: "string",
      alias: "t",
      description:
        "Comma-separated tier buckets to include: now,next,later,unscheduled,done,abandoned. Defaults to 'now'.",
    },
    all: {
      type: "boolean",
      description: "Emit all tier buckets plus recent_observations_unlinked.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = wsArg(args.workstream);
    hintCtx(wsVal);
    recordQuery("CONTEXT_SHOW", wsVal);
    const showArchived = Boolean(args["show-archived"]);

    const VALID_TIERS = new Set(["now", "next", "later", "unscheduled", "done", "abandoned"]);
    let requestedTiers: Set<string>;
    if (args.all) {
      requestedTiers = new Set(VALID_TIERS);
    } else if (args.tier) {
      const parts = (args.tier as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const p of parts) {
        if (!VALID_TIERS.has(p)) {
          throw new Error(
            `Invalid tier value: "${p}". Valid values: ${[...VALID_TIERS].join(", ")}`,
          );
        }
      }
      requestedTiers = new Set(parts);
    } else {
      requestedTiers = new Set(["now"]);
    }
    const includeExtras = Boolean(args.all);
    const db = getDb();
    const wsRow = (
      await db.select().from(workstreams).where(eq(workstreams.id, wsVal)).limit(1)
    )[0];
    if (!wsRow)
      throw new NotFoundError(`workstream not found: ${wsVal}`, {
        id: wsVal,
      });

    const allProblemsRaw = await db
      .select()
      .from(problems)
      .where(eq(problems.workstreamId, wsRow.id));
    const allProblems = [...allProblemsRaw].sort((a, b) => {
      const d = rankStatus(a.status) - rankStatus(b.status);
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });

    const digestProblems = await Promise.all(
      allProblems.map(async (p) => {
        // Evidence + inlined observation.
        const ev = await db.select().from(evidence).where(eq(evidence.problemId, p.id));
        const obsIds = ev.map((e) => e.observationId);
        const obsRows = obsIds.length
          ? await db.select().from(observations).where(inArray(observations.id, obsIds))
          : [];
        const obsById = new Map(obsRows.map((o) => [o.id, o]));
        const evidenceInlined = ev.map((e) => {
          const obs = obsById.get(e.observationId) ?? null;
          if (!obs) return { ...e, observation: null };
          const archive = obs.archivedAt
            ? {
                rationale: obs.archiveRationale,
                archivedById: obs.archivedById,
                archivedAt: obs.archivedAt,
              }
            : null;
          return { ...e, observation: { ...obs, archive } };
        });

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

        const hasShippedSolution = sols.some((s) => s.status === "shipped");
        return {
          ...p,
          evidence: evidenceInlined,
          solutions: solutionsInlined,
          latest_decision: latestDecisionPayload,
          eliminations: eliminationsInlined,
          abandonment: abandonRows[0] ?? null,
          legal_next_transitions: legalNextTransitions(p.status, hasShippedSolution),
        };
      }),
    );

    // Unlinked observations (no evidence row referencing them). Archived are
    // hidden by default; --show-archived reveals them with archive metadata inlined.
    const allWsObs = await db
      .select()
      .from(observations)
      .where(
        showArchived
          ? eq(observations.workstreamId, wsRow.id)
          : and(eq(observations.workstreamId, wsRow.id), isNull(observations.archivedAt)),
      );
    const linkedObsIds = new Set(
      (await db.select({ id: evidence.observationId }).from(evidence)).map((r) => r.id),
    );
    const unlinked = allWsObs
      .filter((o) => !linkedObsIds.has(o.id))
      .map((o) => {
        const archive = o.archivedAt
          ? {
              rationale: o.archiveRationale,
              archivedById: o.archivedById,
              archivedAt: o.archivedAt,
            }
          : null;
        return { ...o, archive };
      });

    const output: Record<string, unknown> = {
      workstream: wsRow,
      seed_version: SEED_VERSION,
    };
    if (requestedTiers.has("now")) output.now = digestProblems.filter((p) => p.status === "now");
    if (requestedTiers.has("next")) output.next = digestProblems.filter((p) => p.status === "next");
    if (requestedTiers.has("later"))
      output.later = digestProblems.filter((p) => p.status === "later");
    if (requestedTiers.has("unscheduled"))
      output.unscheduled = digestProblems.filter((p) => p.status == null);
    if (requestedTiers.has("done")) output.done = digestProblems.filter((p) => p.status === "done");
    if (requestedTiers.has("abandoned"))
      output.abandoned = digestProblems.filter((p) => p.status === "abandoned");
    if (includeExtras) {
      output.recent_observations_unlinked = unlinked;
    }
    emit(output, ContextOutput);
  },
});
