/**
 * query(request) — the single entry point for every read of the corpus.
 *
 * The read counterpart of `dispatch()`. Both live server-side: the Worker owns
 * the database, so a client asks for a *named read* with parameters rather than
 * composing SQL of its own. Every result here is the exact JSON the CLI prints,
 * which is why the query layer — not the command file — is where a `--json`
 * shape is defined and tested.
 *
 * Read kinds that used to leave a trace in `recentQueries` still do; the
 * bookkeeping moved here with them, behind the same `ViewStore` seam dispatch
 * uses, so it works against a file locally and a Durable Object in the cloud.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { CruxDb } from "../db/client.js";
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
} from "../db/schema.js";
import { NotFoundError } from "../transitions/errors.js";
import type { ViewStore } from "../view-state/store.js";
import { computeSaveViewMetaBlob, loadViewMetaFromBlob } from "../view-state/persistence.js";
import { appendRecentQuery } from "../actions/recent-queries.js";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const id = z.union([z.string(), z.number()]);

export const QuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WORKSTREAM_LIST") }),
  z.object({ kind: z.literal("WORKSTREAM_SHOW"), id: z.string() }),
  z.object({ kind: z.literal("WORKSTREAM_GET"), id: z.string() }),
  z.object({ kind: z.literal("WORKSTREAM_BY_SLUG"), slug: z.string() }),
  z.object({ kind: z.literal("WORKSTREAM_SUMMARIES") }),

  z.object({ kind: z.literal("OBSERVATION_LIST"), workstream: z.string() }),
  z.object({ kind: z.literal("OBSERVATION_SHOW"), id: z.string() }),
  z.object({ kind: z.literal("OBSERVATION_DETAIL"), id: z.string() }),
  z.object({
    kind: z.literal("OBSERVATION_UNLINKED"),
    workstreamId: z.string(),
    showArchived: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("OBSERVATION_SUMMARIES"), workstreamId: z.string() }),

  z.object({
    kind: z.literal("PROBLEM_LIST"),
    workstream: z.string(),
    status: z.string().optional(),
  }),
  z.object({ kind: z.literal("PROBLEM_SHOW"), id }),
  z.object({ kind: z.literal("PROBLEM_GET"), id }),
  z.object({ kind: z.literal("PROBLEM_SUMMARIES"), workstreamId: z.string() }),
  z.object({ kind: z.literal("PROBLEM_DETAIL"), id }),

  z.object({ kind: z.literal("EVIDENCE_LIST"), problem: id.optional() }),

  z.object({ kind: z.literal("SOLUTION_LIST"), problem: id.optional() }),
  z.object({ kind: z.literal("SOLUTION_SHOW"), id }),
  z.object({ kind: z.literal("SOLUTION_GET"), id }),
  z.object({ kind: z.literal("SOLUTION_DETAIL"), id }),
  z.object({ kind: z.literal("SOLUTION_BY_IDS"), ids: z.array(id) }),

  z.object({ kind: z.literal("DECISION_LIST") }),

  z.object({ kind: z.literal("ELIMINATION_LIST"), problem: id.optional() }),
  z.object({ kind: z.literal("ELIMINATION_SHOW"), id: z.string() }),

  z.object({ kind: z.literal("ABANDONMENT_LIST"), workstream: z.string() }),
  z.object({ kind: z.literal("ABANDONMENT_SHOW"), id: z.string() }),

  z.object({ kind: z.literal("OUTCOME_LIST") }),
  z.object({ kind: z.literal("OUTCOME_SHOW"), id: z.string() }),

  z.object({
    kind: z.literal("SEARCH"),
    q: z.string().min(1),
    workstream: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),

  z.object({
    kind: z.literal("CONTEXT"),
    workstream: z.string(),
    stages: z.array(z.string()).optional(),
    includeExtras: z.boolean().optional(),
    showArchived: z.boolean().optional(),
  }),
]);

export type QueryRequest = z.infer<typeof QuerySchema>;
export type QueryKind = QueryRequest["kind"];

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * The shapes the richer reads answer with.
 *
 * These exist because `query()` returns `unknown` — it has to, since one entry
 * point serves twenty-odd kinds — and a caller that wants a typed result would
 * otherwise redeclare the shape on its side and cast to it, which is drift with
 * extra steps. They are *derived*, not restated: row types come from drizzle's
 * `$inferSelect` and the composite parts from the helpers that build them, and
 * each read below asserts its return with `satisfies`. A column rename or a
 * helper that stops returning a field is a compile error here rather than a
 * surprise at the far end.
 */
export type WorkstreamRow = typeof workstreams.$inferSelect;
export type ProblemRow = typeof problems.$inferSelect;
export type SolutionRow = typeof solutions.$inferSelect;
export type ObservationRow = typeof observations.$inferSelect;
export type AbandonmentRow = typeof abandonments.$inferSelect;

export type ObservationWithArchive = ObservationRow & { archive: ArchiveBlock };
export type DecisionWithRejected = Awaited<ReturnType<typeof latestDecisionFor>>;
export type EliminationWithTargets = Awaited<ReturnType<typeof eliminationsFor>>[number];
export type SolutionWithOutcome = Awaited<ReturnType<typeof solutionsWithOutcomes>>[number];
export type EvidenceWithObservation = Awaited<ReturnType<typeof evidenceWithObservations>>[number];

export type WorkstreamSummary = WorkstreamRow & { openProblemCount: number };

/**
 * An Observation with the state it does not store.
 *
 * Observation has no `status` column, by design — its state is derivable from
 * related rows (see the Principles in the README). `problemCount` is how many
 * Problems it is Evidence for, which is the whole of "has this been used"; the
 * archive block is the other half, the human judgment that it will not be. An
 * Observation with neither is intake that nobody has triaged yet.
 */
export type ObservationSummary = ObservationWithArchive & { problemCount: number };

export type ProblemSummary = ProblemRow & {
  evidenceCount: number;
  solutionCount: number;
  decided: boolean;
};

export type ProblemDetail = {
  problem: ProblemRow;
  evidence: EvidenceWithObservation[];
  solutions: SolutionWithOutcome[];
  latestDecision: DecisionWithRejected;
  eliminations: EliminationWithTargets[];
  abandonment: AbandonmentRow | null;
};

export type OutcomeWithFollowUps =
  | (typeof outcomes.$inferSelect & { followUpProblemIds: number[] })
  | null;

export type SolutionDetail = {
  solution: SolutionRow;
  problem: ProblemRow;
  choosingDecision: DecisionWithRejected;
  rejectingDecision: DecisionWithRejected;
  eliminatedBy: EliminationWithTargets[];
  outcome: OutcomeWithFollowUps;
};

export type ObservationDetail = {
  observation: ObservationWithArchive;
  evidenceLinks: Array<typeof evidence.$inferSelect & { problem: ProblemRow }>;
};

/**
 * What a search answers with: the rows themselves, each tagged with the slug of
 * the Workstream it belongs to. A cross-workstream search is the one read where
 * `workstreamId` alone is not enough to place a match, and placing it is half of
 * deciding whether it is the same thing.
 */
export type SearchResults = {
  query: string;
  problems: Array<ProblemRow & { workstreamSlug: string }>;
  observations: Array<ObservationWithArchive & { workstreamSlug: string }>;
};

/** Read kinds that leave a trace in `recentQueries`, and the entry they write. */
const RECORDED: Partial<Record<QueryKind, { kind: string; slug: (q: never) => string }>> = {
  PROBLEM_SHOW: { kind: "PROBLEM_SHOW", slug: (q: { id: string | number }) => String(q.id) },
  CONTEXT: { kind: "CONTEXT_SHOW", slug: (q: { workstream: string }) => q.workstream },
} as Partial<Record<QueryKind, { kind: string; slug: (q: never) => string }>>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const numeric = (v: string | number): number =>
  typeof v === "number" ? v : parseInt(String(v), 10);

const STATUS_RANK: Record<string, number> = { now: 0, next: 1, later: 2, done: 4, abandoned: 5 };
const rankStatus = (s: string | null): number => (s == null ? 3 : (STATUS_RANK[s] ?? 99));

const SOLUTION_STATUS_RANK: Record<string, number> = {
  chosen: 0,
  shipped: 1,
  evaluated: 2,
  proposed: 3,
  rejected: 4,
};

export type ArchiveBlock = {
  rationale: string | null;
  archivedById: string | null;
  archivedAt: number;
} | null;

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

async function requireWorkstream(db: CruxDb, idOrSlug: string) {
  const byId = (
    await db.select().from(workstreams).where(eq(workstreams.id, idOrSlug)).limit(1)
  )[0];
  if (byId) return byId;
  const bySlug = (
    await db.select().from(workstreams).where(eq(workstreams.slug, idOrSlug)).limit(1)
  )[0];
  if (bySlug) return bySlug;
  throw new NotFoundError(`workstream not found: ${idOrSlug}`, { id: idOrSlug });
}

async function requireProblem(db: CruxDb, raw: string | number) {
  const rows = await db
    .select()
    .from(problems)
    .where(eq(problems.id, numeric(raw)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`problem not found: ${raw}`, { id: raw });
  return row;
}

/** Rejected-solution ids for one decision, in insertion order. */
async function rejectedFor(db: CruxDb, decisionId: string): Promise<number[]> {
  const rows = await db
    .select({ solutionId: decisionRejectedSolutions.solutionId })
    .from(decisionRejectedSolutions)
    .where(eq(decisionRejectedSolutions.decisionId, decisionId));
  return rows.map((r) => r.solutionId);
}

/** The most recent Decision for a Problem, with its rejected ids inlined. */
async function latestDecisionFor(db: CruxDb, problemId: number) {
  const row = (
    await db
      .select()
      .from(decisions)
      .where(eq(decisions.problemId, problemId))
      .orderBy(desc(decisions.createdAt))
      .limit(1)
  )[0];
  if (!row) return null;
  return { ...row, rejectedSolutionIds: await rejectedFor(db, row.id) };
}

/** Solutions for a Problem with each one's Outcome (and its follow-ups) inlined. */
async function solutionsWithOutcomes(db: CruxDb, problemId: number) {
  const sols = await db.select().from(solutions).where(eq(solutions.problemId, problemId));
  const solIds = sols.map((s) => s.id);
  const outcomeRows = solIds.length
    ? await db.select().from(outcomes).where(inArray(outcomes.solutionId, solIds))
    : [];
  const outcomeIds = outcomeRows.map((o) => o.id);
  const followUps = outcomeIds.length
    ? await db
        .select()
        .from(outcomeFollowUpProblems)
        .where(inArray(outcomeFollowUpProblems.outcomeId, outcomeIds))
    : [];
  const followUpsByOutcome = new Map<string, number[]>();
  for (const f of followUps) {
    const list = followUpsByOutcome.get(f.outcomeId) ?? [];
    list.push(f.problemId);
    followUpsByOutcome.set(f.outcomeId, list);
  }
  const outcomeBySol = new Map(outcomeRows.map((o) => [o.solutionId, o]));
  return sols.map((s) => {
    const outcome = outcomeBySol.get(s.id);
    return {
      ...s,
      outcome: outcome
        ? { ...outcome, followUpProblemIds: followUpsByOutcome.get(outcome.id) ?? [] }
        : null,
    };
  });
}

/** Eliminations for a Problem, each with the solution ids it targeted. */
async function eliminationsFor(db: CruxDb, problemId: number) {
  const rows = await db.select().from(eliminations).where(eq(eliminations.problemId, problemId));
  const ids = rows.map((e) => e.id);
  const joins = ids.length
    ? await db
        .select()
        .from(eliminationSolutions)
        .where(inArray(eliminationSolutions.eliminationId, ids))
    : [];
  const byElim = new Map<string, number[]>();
  for (const j of joins) {
    const list = byElim.get(j.eliminationId) ?? [];
    list.push(j.solutionId);
    byElim.set(j.eliminationId, list);
  }
  return rows.map((e) => ({ ...e, eliminatedSolutionIds: byElim.get(e.id) ?? [] }));
}

/** Evidence for a Problem with each linked Observation (and its archive block). */
async function evidenceWithObservations(db: CruxDb, problemId: number, sortByCreatedAt = false) {
  const evRows = await db.select().from(evidence).where(eq(evidence.problemId, problemId));
  if (sortByCreatedAt) evRows.sort((a, b) => a.createdAt - b.createdAt);
  const obsIds = evRows.map((e) => e.observationId);
  const obsRows = obsIds.length
    ? await db.select().from(observations).where(inArray(observations.id, obsIds))
    : [];
  const obsById = new Map(obsRows.map((o) => [o.id, o]));
  return evRows.map((e) => {
    const obs = obsById.get(e.observationId);
    return { ...e, observation: obs ? { ...obs, archive: toArchive(obs) } : null };
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** How many matches of each kind a search answers with unless asked otherwise. */
const SEARCH_DEFAULT_LIMIT = 20;

/**
 * A case-insensitive substring predicate, with the caller's `%` and `_` made
 * literal so a query containing either matches the character rather than acting
 * as a wildcard.
 *
 * Substring rather than FTS5, settled by probing D1 inside workerd rather than
 * assumed: FTS5 *is* available there — the virtual table creates, in a batch
 * too, and `MATCH` returns rows — but its match semantics are wrong for this
 * job. `MATCH 'auth'` finds nothing in "reauthentication keeps failing", where
 * `LIKE '%auth%'` finds it, and near-duplicate hunting wants the loose match.
 * Raw user text is also not a legal MATCH query (`sign-in "flow` throws
 * "unterminated string"), so FTS5 would owe us query sanitising plus triggers
 * keeping the index in step with every write. At this corpus size that buys
 * nothing. The read's shape does not encode the choice, so it can be swapped.
 */
function substringMatch(column: SQLiteColumn, needle: string) {
  const pattern = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

async function searchCorpus(
  db: CruxDb,
  q: Extract<QueryRequest, { kind: "SEARCH" }>,
): Promise<SearchResults> {
  const ws = q.workstream ? await requireWorkstream(db, q.workstream) : null;
  const limit = q.limit ?? SEARCH_DEFAULT_LIMIT;
  const scoped = (workstreamColumn: SQLiteColumn, match: ReturnType<typeof substringMatch>) =>
    ws ? and(eq(workstreamColumn, ws.id), match) : match;

  const problemRows = await db
    .select()
    .from(problems)
    .where(
      scoped(
        problems.workstreamId,
        or(substringMatch(problems.title, q.q), substringMatch(problems.description, q.q))!,
      ),
    )
    .orderBy(desc(problems.createdAt))
    .limit(limit);

  const observationRows = await db
    .select()
    .from(observations)
    .where(scoped(observations.workstreamId, substringMatch(observations.content, q.q)))
    .orderBy(desc(observations.createdAt))
    .limit(limit);

  const wsIds = [
    ...new Set([
      ...problemRows.map((p) => p.workstreamId),
      ...observationRows.map((o) => o.workstreamId),
    ]),
  ];
  const wsRows = wsIds.length
    ? await db.select().from(workstreams).where(inArray(workstreams.id, wsIds))
    : [];
  // Every row was just selected by its own `workstream_id`, which is a foreign
  // key — the lookup cannot miss.
  const slugById = new Map(wsRows.map((w) => [w.id, w.slug]));
  const slugOf = (id: string) => slugById.get(id)!;

  return {
    query: q.q,
    problems: problemRows.map((p) => ({ ...p, workstreamSlug: slugOf(p.workstreamId) })),
    observations: observationRows.map((o) => ({
      ...o,
      archive: toArchive(o),
      workstreamSlug: slugOf(o.workstreamId),
    })),
  } satisfies SearchResults;
}

// ---------------------------------------------------------------------------
// The context digest
// ---------------------------------------------------------------------------

const SEED_VERSION = "2026-04-21";

const VALID_STAGES = ["now", "next", "later", "unscheduled", "done", "abandoned"] as const;

function legalNextTransitions(status: string | null, hasShippedSolution: boolean): string[] {
  if (status === "done" || status === "abandoned") return [];
  const events: string[] = ["schedule", "abandon"];
  if (status !== null) events.push("unschedule");
  if (hasShippedSolution) events.push("done");
  return events;
}

async function contextDigest(
  db: CruxDb,
  q: Extract<QueryRequest, { kind: "CONTEXT" }>,
): Promise<Record<string, unknown>> {
  const requested = new Set(q.stages?.length ? q.stages : ["now"]);
  for (const s of requested) {
    if (!(VALID_STAGES as readonly string[]).includes(s)) {
      throw new Error(`Invalid stage value: "${s}". Valid values: ${VALID_STAGES.join(", ")}`);
    }
  }
  const showArchived = Boolean(q.showArchived);
  const wsRow = await requireWorkstream(db, q.workstream);

  const allProblemsRaw = await db
    .select()
    .from(problems)
    .where(eq(problems.workstreamId, wsRow.id));
  const allProblems = [...allProblemsRaw].sort((a, b) => {
    const d = rankStatus(a.status) - rankStatus(b.status);
    return d !== 0 ? d : a.createdAt - b.createdAt;
  });

  const digestProblems = await Promise.all(
    allProblems.map(async (p) => {
      const solutionsInlined = await solutionsWithOutcomes(db, p.id);
      const abandonRows = await db
        .select()
        .from(abandonments)
        .where(eq(abandonments.problemId, p.id))
        .limit(1);
      return {
        ...p,
        evidence: await evidenceWithObservations(db, p.id),
        solutions: solutionsInlined,
        latest_decision: await latestDecisionFor(db, p.id),
        eliminations: await eliminationsFor(db, p.id),
        abandonment: abandonRows[0] ?? null,
        legal_next_transitions: legalNextTransitions(
          p.status,
          solutionsInlined.some((s) => s.status === "shipped"),
        ),
      };
    }),
  );

  const output: Record<string, unknown> = { workstream: wsRow, seed_version: SEED_VERSION };
  if (requested.has("now")) output.now = digestProblems.filter((p) => p.status === "now");
  if (requested.has("next")) output.next = digestProblems.filter((p) => p.status === "next");
  if (requested.has("later")) output.later = digestProblems.filter((p) => p.status === "later");
  if (requested.has("unscheduled"))
    output.unscheduled = digestProblems.filter((p) => p.status == null);
  if (requested.has("done")) output.done = digestProblems.filter((p) => p.status === "done");
  if (requested.has("abandoned"))
    output.abandoned = digestProblems.filter((p) => p.status === "abandoned");
  if (q.includeExtras) {
    output.recent_observations_unlinked = await unlinkedObservations(db, wsRow.id, showArchived);
  }
  return output;
}

async function unlinkedObservations(db: CruxDb, workstreamId: string, showArchived: boolean) {
  const rows = await db
    .select()
    .from(observations)
    .where(
      showArchived
        ? eq(observations.workstreamId, workstreamId)
        : and(eq(observations.workstreamId, workstreamId), isNull(observations.archivedAt)),
    );
  const linked = new Set(
    (await db.select({ id: evidence.observationId }).from(evidence)).map((r) => r.id),
  );
  return rows.filter((o) => !linked.has(o.id)).map((o) => ({ ...o, archive: toArchive(o) }));
}

// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

/**
 * Run a named read. Throws `NotFoundError` for a missing entity a command
 * requires, exactly as the local path did, so the error envelope and the CLI's
 * exit code are unchanged.
 */
export async function query(
  rawQuery: unknown,
  options: { db: CruxDb; viewStore?: ViewStore },
): Promise<unknown> {
  const q = QuerySchema.parse(rawQuery);
  const { db } = options;

  const result = await run(q, db);

  const record = RECORDED[q.kind];
  if (record && options.viewStore) {
    await recordRecentQuery(
      options.viewStore,
      record.kind,
      (record.slug as (x: unknown) => string)(q),
    );
  }
  return result;
}

async function recordRecentQuery(store: ViewStore, kind: string, slug: string): Promise<void> {
  try {
    const blob = await store.read();
    const meta = loadViewMetaFromBlob(blob);
    meta.recentQueries = appendRecentQuery(meta.recentQueries, { kind, slug, ts: Date.now() });
    await store.write(computeSaveViewMetaBlob(blob, meta));
  } catch {
    // Best-effort — a read command never fails because of recentQueries.
  }
}

async function run(q: QueryRequest, db: CruxDb): Promise<unknown> {
  switch (q.kind) {
    case "WORKSTREAM_LIST":
      return db.select().from(workstreams);

    case "WORKSTREAM_SHOW": {
      const rows = await db.select().from(workstreams).where(eq(workstreams.id, q.id)).limit(1);
      if (rows.length === 0) throw new NotFoundError(`workstream not found: ${q.id}`, { id: q.id });
      return rows[0]!;
    }

    case "WORKSTREAM_GET": {
      const rows = await db.select().from(workstreams).where(eq(workstreams.id, q.id)).limit(1);
      return rows[0] ?? null;
    }

    case "WORKSTREAM_BY_SLUG": {
      const rows = await db.select().from(workstreams).where(eq(workstreams.slug, q.slug)).limit(1);
      return rows[0] ?? null;
    }

    case "WORKSTREAM_SUMMARIES": {
      const wsRows = await db.select().from(workstreams);
      const allProblems = await db.select().from(problems);
      const openByWs = new Map<string, number>();
      for (const p of allProblems) {
        if (p.status !== "done" && p.status !== "abandoned") {
          openByWs.set(p.workstreamId, (openByWs.get(p.workstreamId) ?? 0) + 1);
        }
      }
      return wsRows.map(
        (w) => ({ ...w, openProblemCount: openByWs.get(w.id) ?? 0 }) satisfies WorkstreamSummary,
      );
    }

    case "OBSERVATION_LIST": {
      const ws = await requireWorkstream(db, q.workstream);
      return db.select().from(observations).where(eq(observations.workstreamId, ws.id));
    }

    case "OBSERVATION_SHOW": {
      const rows = await db.select().from(observations).where(eq(observations.id, q.id)).limit(1);
      if (rows.length === 0)
        throw new NotFoundError(`observation not found: ${q.id}`, { id: q.id });
      return rows[0]!;
    }

    case "OBSERVATION_DETAIL": {
      const rows = await db.select().from(observations).where(eq(observations.id, q.id)).limit(1);
      const obs = rows[0];
      if (!obs) return null;
      const evRows = await db.select().from(evidence).where(eq(evidence.observationId, q.id));
      const probIds = evRows.map((e) => e.problemId);
      const probRows = probIds.length
        ? await db.select().from(problems).where(inArray(problems.id, probIds))
        : [];
      const probById = new Map(probRows.map((p) => [p.id, p]));
      const evidenceLinks = evRows
        .map((e) => ({ ...e, problem: probById.get(e.problemId)! }))
        .filter((e) => e.problem);
      return {
        observation: { ...obs, archive: toArchive(obs) },
        evidenceLinks,
      } satisfies ObservationDetail;
    }

    case "OBSERVATION_UNLINKED": {
      const rows = await unlinkedObservations(db, q.workstreamId, Boolean(q.showArchived));
      return [...rows].sort((a, b) => b.createdAt - a.createdAt);
    }

    case "OBSERVATION_SUMMARIES": {
      const rows = await db
        .select()
        .from(observations)
        .where(eq(observations.workstreamId, q.workstreamId));
      // Every Evidence row, unfiltered — the same shape `unlinkedObservations`
      // uses above, and for the same reason: the alternative is an `inArray`
      // over every Observation id in the Workstream, which is the parameter
      // limit this deployment would hit first.
      const ev = await db.select({ observationId: evidence.observationId }).from(evidence);
      // Counting rows *is* counting Problems: `evidence_obs_problem_unique`
      // permits one Evidence row per (Observation, Problem) pair, so a second
      // why-note about the same Problem is a conflict, not a second row.
      const count = new Map<string, number>();
      for (const e of ev) count.set(e.observationId, (count.get(e.observationId) ?? 0) + 1);
      return rows
        .map(
          (o) =>
            ({
              ...o,
              archive: toArchive(o),
              problemCount: count.get(o.id) ?? 0,
            }) satisfies ObservationSummary,
        )
        .sort((a, b) => b.createdAt - a.createdAt);
    }

    case "PROBLEM_LIST": {
      const ws = await requireWorkstream(db, q.workstream);
      const where =
        q.status === "unscheduled"
          ? and(eq(problems.workstreamId, ws.id), isNull(problems.status))
          : q.status
            ? and(eq(problems.workstreamId, ws.id), eq(problems.status, q.status))
            : eq(problems.workstreamId, ws.id);
      return db.select().from(problems).where(where);
    }

    case "PROBLEM_GET": {
      const rows = await db
        .select()
        .from(problems)
        .where(eq(problems.id, numeric(q.id)))
        .limit(1);
      return rows[0] ?? null;
    }

    case "PROBLEM_SHOW": {
      const p = await requireProblem(db, q.id);
      return {
        ...p,
        solutions: await solutionsWithOutcomes(db, p.id),
        latest_decision: await latestDecisionFor(db, p.id),
      };
    }

    case "PROBLEM_SUMMARIES": {
      const rows = await db
        .select()
        .from(problems)
        .where(eq(problems.workstreamId, q.workstreamId));
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
      // `decided` completes the Evidence → Solutions → Decision narrowing at a
      // glance, so a summary row can say how far a Problem got without the
      // caller fetching each Problem's detail to find out.
      const dec = await db
        .select({ problemId: decisions.problemId })
        .from(decisions)
        .where(inArray(decisions.problemId, ids));
      const decided = new Set(dec.map((d) => d.problemId));
      return rows
        .map(
          (r) =>
            ({
              ...r,
              evidenceCount: evCount.get(r.id) ?? 0,
              solutionCount: solCount.get(r.id) ?? 0,
              decided: decided.has(r.id),
            }) satisfies ProblemSummary,
        )
        .sort((a, b) => {
          const d = rankStatus(a.status) - rankStatus(b.status);
          return d !== 0 ? d : a.createdAt - b.createdAt;
        });
    }

    case "PROBLEM_DETAIL": {
      const problemId = numeric(q.id);
      const rows = await db.select().from(problems).where(eq(problems.id, problemId)).limit(1);
      const p = rows[0];
      if (!p) return null;
      const solutionsInlined = (await solutionsWithOutcomes(db, problemId)).sort((a, b) => {
        const d = (SOLUTION_STATUS_RANK[a.status] ?? 9) - (SOLUTION_STATUS_RANK[b.status] ?? 9);
        return d !== 0 ? d : a.createdAt - b.createdAt;
      });
      const abandonRow = (
        await db.select().from(abandonments).where(eq(abandonments.problemId, problemId)).limit(1)
      )[0];
      return {
        problem: p,
        evidence: await evidenceWithObservations(db, problemId, true),
        solutions: solutionsInlined,
        latestDecision: await latestDecisionFor(db, problemId),
        eliminations: await eliminationsFor(db, problemId),
        abandonment: abandonRow ?? null,
      } satisfies ProblemDetail;
    }

    case "EVIDENCE_LIST": {
      if (q.problem !== undefined) {
        const p = await requireProblem(db, q.problem);
        return db.select().from(evidence).where(eq(evidence.problemId, p.id));
      }
      return db.select().from(evidence);
    }

    case "SOLUTION_LIST": {
      if (q.problem !== undefined) {
        const p = await requireProblem(db, q.problem);
        return db.select().from(solutions).where(eq(solutions.problemId, p.id));
      }
      return db.select().from(solutions);
    }

    case "SOLUTION_SHOW": {
      const rows = await db
        .select()
        .from(solutions)
        .where(eq(solutions.id, numeric(q.id)))
        .limit(1);
      if (rows.length === 0) throw new NotFoundError(`solution not found: ${q.id}`, { id: q.id });
      return rows[0]!;
    }

    case "SOLUTION_GET": {
      const rows = await db
        .select()
        .from(solutions)
        .where(eq(solutions.id, numeric(q.id)))
        .limit(1);
      return rows[0] ?? null;
    }

    case "SOLUTION_BY_IDS": {
      const ids = q.ids.map(numeric);
      if (ids.length === 0) return [];
      return db.select().from(solutions).where(inArray(solutions.id, ids));
    }

    case "SOLUTION_DETAIL": {
      const solutionId = numeric(q.id);
      const s = (await db.select().from(solutions).where(eq(solutions.id, solutionId)).limit(1))[0];
      if (!s) return null;
      const pr = (await db.select().from(problems).where(eq(problems.id, s.problemId)).limit(1))[0];
      if (!pr) return null;

      const allDec = await db
        .select()
        .from(decisions)
        .where(eq(decisions.problemId, pr.id))
        .orderBy(desc(decisions.createdAt));
      let choosingDecision: DecisionWithRejected = null;
      let rejectingDecision: DecisionWithRejected = null;
      for (const d of allDec) {
        const rej = await rejectedFor(db, d.id);
        if (d.chosenSolutionId === solutionId && !choosingDecision) {
          choosingDecision = { ...d, rejectedSolutionIds: rej };
        }
        if (!rejectingDecision && rej.includes(solutionId)) {
          rejectingDecision = { ...d, rejectedSolutionIds: rej };
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

      const outRow = (
        await db.select().from(outcomes).where(eq(outcomes.solutionId, solutionId)).limit(1)
      )[0];
      let outcome: OutcomeWithFollowUps = null;
      if (outRow) {
        const fu = await db
          .select()
          .from(outcomeFollowUpProblems)
          .where(eq(outcomeFollowUpProblems.outcomeId, outRow.id));
        outcome = { ...outRow, followUpProblemIds: fu.map((f) => f.problemId) };
      }

      return {
        solution: s,
        problem: pr,
        choosingDecision,
        rejectingDecision,
        eliminatedBy,
        outcome,
      } satisfies SolutionDetail;
    }

    case "DECISION_LIST":
      return db.select().from(decisions);

    case "ELIMINATION_LIST": {
      if (q.problem !== undefined) {
        const p = await requireProblem(db, q.problem);
        return db.select().from(eliminations).where(eq(eliminations.problemId, p.id));
      }
      return db.select().from(eliminations);
    }

    case "ELIMINATION_SHOW": {
      const rows = await db.select().from(eliminations).where(eq(eliminations.id, q.id)).limit(1);
      if (rows.length === 0)
        throw new NotFoundError(`elimination not found: ${q.id}`, { id: q.id });
      const joins = await db
        .select({ solutionId: eliminationSolutions.solutionId })
        .from(eliminationSolutions)
        .where(eq(eliminationSolutions.eliminationId, q.id));
      return { ...rows[0]!, eliminatedSolutionIds: joins.map((j) => j.solutionId) };
    }

    case "ABANDONMENT_LIST": {
      const ws = await requireWorkstream(db, q.workstream);
      const wsProblems = await db
        .select({ id: problems.id })
        .from(problems)
        .where(eq(problems.workstreamId, ws.id));
      const problemIds = wsProblems.map((p) => p.id);
      if (problemIds.length === 0) return [];
      return db.select().from(abandonments).where(inArray(abandonments.problemId, problemIds));
    }

    case "ABANDONMENT_SHOW": {
      const rows = await db.select().from(abandonments).where(eq(abandonments.id, q.id)).limit(1);
      if (rows.length === 0)
        throw new NotFoundError(`abandonment not found: ${q.id}`, { id: q.id });
      return rows[0]!;
    }

    case "OUTCOME_LIST":
      return db.select().from(outcomes);

    case "OUTCOME_SHOW": {
      const rows = await db.select().from(outcomes).where(eq(outcomes.id, q.id)).limit(1);
      if (rows.length === 0) throw new NotFoundError(`outcome not found: ${q.id}`, { id: q.id });
      const followUps = await db
        .select({ problemId: outcomeFollowUpProblems.problemId })
        .from(outcomeFollowUpProblems)
        .where(eq(outcomeFollowUpProblems.outcomeId, q.id));
      return { ...rows[0]!, followUpProblemIds: followUps.map((f) => f.problemId) };
    }

    case "SEARCH":
      return searchCorpus(db, q);

    case "CONTEXT":
      return contextDigest(db, q);
  }
}
