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
 *
 * Every read is scoped to the Principal that asked for it (ADR-0013). The scope
 * is resolved once, here, from the identity the *server* attached to the request
 * — never from anything the client sent — and it is a required option rather
 * than an optional filter, so a caller cannot reach the corpus without saying
 * whose corpus it is. One missed predicate is a cross-tenant disclosure, not a
 * bug, which is why the predicate lives at the single entry point instead of at
 * twenty call sites.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { CruxDb } from "../db/client.js";
import {
  abandonments,
  attempts,
  evidence,
  observations,
  outcomes,
  outcomeFollowUpProblems,
  problems,
  revisions,
  workstreams,
} from "../db/schema.js";
import { NotFoundError, ValidationError } from "../transitions/errors.js";
import {
  findProblemInScope,
  findWorkstreamBySlugInScope,
  problemsInScope,
  requireAbandonmentInScope,
  requireAttemptInScope,
  requireEvidenceInScope,
  requireOutcomeInScope,
  requireProblemInScope,
  requireWorkstreamInScope,
  scopeFor,
  type Principal,
  type Scope,
} from "../auth/principals.js";
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
  z.object({ kind: z.literal("WORKSTREAM_REVISIONS"), id: z.string() }),

  z.object({
    kind: z.literal("OBSERVATION_LIST"),
    workstream: z.string(),
    showArchived: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("OBSERVATION_SHOW"), id: z.string() }),
  z.object({ kind: z.literal("OBSERVATION_REVISIONS"), id: z.string() }),
  z.object({ kind: z.literal("OBSERVATION_DETAIL"), id: z.string() }),
  z.object({
    kind: z.literal("OBSERVATION_UNLINKED"),
    workstreamId: z.string(),
    showArchived: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("OBSERVATION_SUMMARIES"),
    workstreamId: z.string(),
    showArchived: z.boolean().optional(),
  }),

  z.object({
    kind: z.literal("PROBLEM_LIST"),
    workstream: z.string(),
    status: z.string().optional(),
  }),
  z.object({ kind: z.literal("PROBLEM_SHOW"), id }),
  z.object({ kind: z.literal("PROBLEM_GET"), id }),
  z.object({ kind: z.literal("PROBLEM_SUMMARIES"), workstreamId: z.string() }),
  z.object({ kind: z.literal("PROBLEM_DETAIL"), id }),
  z.object({ kind: z.literal("PROBLEM_REVISIONS"), id }),

  z.object({ kind: z.literal("EVIDENCE_LIST"), problem: id.optional() }),
  z.object({ kind: z.literal("EVIDENCE_REVISIONS"), id: z.string() }),

  z.object({ kind: z.literal("ATTEMPT_LIST"), problem: id.optional() }),
  z.object({ kind: z.literal("ATTEMPT_REVISIONS"), id: z.string() }),
  z.object({
    kind: z.literal("PROBLEM_DRIFT"),
    workstream: z.string(),
    stages: z.array(z.string()).optional(),
  }),

  z.object({ kind: z.literal("ABANDONMENT_LIST"), workstream: z.string() }),
  z.object({ kind: z.literal("ABANDONMENT_SHOW"), id: z.string() }),
  z.object({ kind: z.literal("ABANDONMENT_REVISIONS"), id: z.string() }),

  z.object({ kind: z.literal("OUTCOME_LIST") }),
  z.object({ kind: z.literal("OUTCOME_SHOW"), id: z.string() }),
  z.object({ kind: z.literal("OUTCOME_REVISIONS"), id: z.string() }),

  z.object({
    kind: z.literal("SEARCH"),
    q: z.string().min(1),
    workstream: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
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
export type ObservationRow = typeof observations.$inferSelect;
export type AbandonmentRow = typeof abandonments.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
/** An Attempt as `ATTEMPT_LIST` answers with it: the row, plus its revision marker. */
export type AttemptListRow = AttemptRow & { revision: RevisionMarker };
/** An Observation as `OBSERVATION_SHOW` answers with it: the row, plus its marker. */
export type ObservationWithRevision = ObservationRow & { revision: RevisionMarker };

/**
 * A Problem that has drifted: staged as active, with no *open* Attempt against
 * it. `attemptCount` is every Attempt ever filed on it, open or closed, which
 * is the distinction a reader wants — one that was worked on and stopped is not
 * the same as one nobody ever touched.
 */
export type DriftingProblem = ProblemRow & { attemptCount: number };

export type ObservationWithArchive = ObservationRow & { archive: ArchiveBlock };
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
  attemptCount: number;
  openAttemptCount: number;
};

export type ProblemDetail = {
  problem: ProblemRow;
  attempts: AttemptRow[];
  evidence: EvidenceWithObservation[];
  abandonment: AbandonmentRow | null;
  outcome: OutcomeWithFollowUps;
  /** That the Problem was corrected, and how many times — null if never. */
  revision: RevisionMarker;
};

/**
 * That a row was corrected, and how many times (ADR-0017).
 *
 * A marker and nothing else: the history itself is a second read, because
 * inlining it would repeat the mistake that killed the old digest command —
 * a hot read grown fat with data almost no caller wants. Null on a row nobody
 * has ever revised, which is not an error.
 */
export type RevisionMarker = { count: number; lastRevisedAt: number } | null;

/**
 * One entry of a row's history: the fields that changed, holding the values
 * they used to have.
 *
 * `changed` is parsed here rather than handed over as the JSON string it is
 * stored as, so the storage shape — the decision most likely to change — stops
 * at this layer. A previous value may be `null`: an Evidence note, an Outcome's
 * learnings and a Workstream's description are all nullable, and "it used to
 * say nothing" is a value the history keeps rather than an absence it drops.
 */
export type RevisionEntry = {
  id: string;
  changed: Record<string, string | null>;
  reason: string | null;
  revisedById: string;
  revisedAt: number;
};

/** An Evidence row as its listing answers with it: the note, plus whether it was corrected. */
export type EvidenceWithRevision = typeof evidence.$inferSelect & { revision: RevisionMarker };

export type OutcomeWithFollowUps =
  | (typeof outcomes.$inferSelect & { followUpProblemIds: number[] })
  | null;

export type ObservationDetail = {
  observation: ObservationWithArchive;
  evidenceLinks: Array<typeof evidence.$inferSelect & { problem: ProblemRow }>;
  /** That the Observation was corrected, and how many times — null if never. */
  revision: RevisionMarker;
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
} as Partial<Record<QueryKind, { kind: string; slug: (q: never) => string }>>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const numeric = (v: string | number): number =>
  typeof v === "number" ? v : parseInt(String(v), 10);

const STATUS_RANK: Record<string, number> = { now: 0, next: 1, later: 2, done: 4, abandoned: 5 };
const rankStatus = (s: string | null): number => (s == null ? 3 : (STATUS_RANK[s] ?? 99));

/** The stages a Problem can be said to be *actively* scheduled in. */
const ACTIVE_STAGES = ["now", "next", "later"] as const;

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

/**
 * The predicate every default listing of Observations carries.
 *
 * Archiving is the recorded judgment that a row has stopped being live, so a
 * read that lists or searches Observations must not hand one back as though it
 * still were — that is how a retired row silently informed a live conclusion
 * (ADR-0017). Naming a row is a different question from listing them, so
 * `OBSERVATION_SHOW`, `OBSERVATION_DETAIL` and everything reached through
 * Evidence are deliberately *not* filtered: an Evidence link is an assertion
 * that this Observation supports this Problem, and hiding it would gut the
 * Problem's argument rather than protect it.
 *
 * `undefined` rather than a tautology when archived rows are wanted, so the
 * caller can drop it out of an `and()` without a no-op clause in the SQL.
 */
const liveOnly = (showArchived: boolean | undefined) =>
  showArchived ? undefined : isNull(observations.archivedAt);

/**
 * Oldest first, breaking ties on the id.
 *
 * `created_at` defaults to `(unixepoch() * 1000)` — whole seconds scaled up —
 * so two Attempts filed in the same second carry identical timestamps. `ATT-###`
 * is monotonic by construction, so it is what makes the order deterministic.
 */
const byFiledOrder = (a: AttemptRow, b: AttemptRow): number =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** Attempts against a Problem, oldest first. */
async function attemptsFor(db: CruxDb, problemId: number): Promise<AttemptRow[]> {
  const rows = await db.select().from(attempts).where(eq(attempts.problemId, problemId));
  return [...rows].sort(byFiledOrder);
}

/**
 * Attempt tallies for a set of Problems, in one query.
 *
 * Two reads want the same two numbers about a Problem — the drift query needs
 * "any open Attempt?", the board card needs "how many, how many still open" —
 * and both derive them from the same scan, so the scan lives here.
 */
async function attemptTallies(
  db: CruxDb,
  problemIds: number[],
): Promise<{ total: Map<number, number>; open: Map<number, number> }> {
  const rows = await db
    .select({ problemId: attempts.problemId, status: attempts.status })
    .from(attempts)
    .where(inArray(attempts.problemId, problemIds));
  const total = new Map<number, number>();
  const open = new Map<number, number>();
  for (const a of rows) {
    total.set(a.problemId, (total.get(a.problemId) ?? 0) + 1);
    if (a.status === "open") open.set(a.problemId, (open.get(a.problemId) ?? 0) + 1);
  }
  return { total, open };
}

/**
 * How many times a row has been revised, and when it last was — one statement,
 * so it can join the wave a read already issues rather than costing a hop after
 * it (ADR-0017).
 */
async function revisionMarkerFor(
  db: CruxDb,
  entity: string,
  entityId: string | number,
): Promise<RevisionMarker> {
  const rows = await db
    .select({ count: sql<number>`count(*)`, last: sql<number>`max(${revisions.revisedAt})` })
    .from(revisions)
    .where(and(eq(revisions.entity, entity), eq(revisions.entityId, String(entityId))));
  const row = rows[0];
  if (!row || !row.count) return null;
  return { count: Number(row.count), lastRevisedAt: Number(row.last) };
}

/**
 * The same marker for every row of one kind, in one statement.
 *
 * Wherever a row is listed rather than shown one at a time — `ATTEMPT_LIST`, the
 * Evidence under a Problem or an Observation — this is where its marker comes
 * from, because a listing that paid a round trip per row would be the N+1 the
 * single-row helper above quietly becomes when it is called in a loop.
 *
 * It groups the whole entity kind rather than naming the ids it wants, on
 * purpose: an unfiltered `attempt list` is corpus-wide, so an `IN (…)` here
 * would bind one parameter per Attempt and eventually cross D1's cap on a read
 * that works today. Revisions are a side record almost nothing writes to, so
 * scanning them by `entity` is the cheaper half of that trade. The caller only
 * ever looks up ids it already resolved in scope.
 */
async function revisionMarkersFor(
  db: CruxDb,
  entity: string,
): Promise<Map<string, RevisionMarker>> {
  const rows = await db
    .select({
      entityId: revisions.entityId,
      count: sql<number>`count(*)`,
      last: sql<number>`max(${revisions.revisedAt})`,
    })
    .from(revisions)
    .where(eq(revisions.entity, entity))
    .groupBy(revisions.entityId);
  const markers = new Map<string, RevisionMarker>();
  for (const r of rows) {
    if (!r.count) continue;
    markers.set(r.entityId, { count: Number(r.count), lastRevisedAt: Number(r.last) });
  }
  return markers;
}

/** The `###` of a `REV-###`, for ordering two revisions filed in the same millisecond. */
const revisionSeq = (id: string): number => Number(id.replace(/^REV-/, "")) || 0;

/**
 * A row's history, newest first.
 *
 * Two revisions filed in the same millisecond carry the same `revised_at`, so
 * the id is what breaks the tie — `REV-###` is monotonic by construction.
 * It is compared as the number it encodes rather than as text, because the
 * suffix is padded to three digits and `"REV-1000"` sorts below `"REV-999"`.
 */
async function revisionsFor(
  db: CruxDb,
  entity: string,
  entityId: string | number,
): Promise<RevisionEntry[]> {
  const rows = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.entity, entity), eq(revisions.entityId, String(entityId))))
    .orderBy(desc(revisions.revisedAt));
  return [...rows]
    .sort((a, b) => b.revisedAt - a.revisedAt || revisionSeq(b.id) - revisionSeq(a.id))
    .map((r) => ({
      id: r.id,
      changed: JSON.parse(r.changed) as Record<string, string | null>,
      reason: r.reason,
      revisedById: r.revisedById,
      revisedAt: r.revisedAt,
    }));
}

/** The Problem's Outcome, with its follow-up Problems inlined — null until it is done. */
async function outcomeFor(db: CruxDb, problemId: number): Promise<OutcomeWithFollowUps> {
  const row = (
    await db.select().from(outcomes).where(eq(outcomes.problemId, problemId)).limit(1)
  )[0];
  if (!row) return null;
  const followUps = await db
    .select({ problemId: outcomeFollowUpProblems.problemId })
    .from(outcomeFollowUpProblems)
    .where(eq(outcomeFollowUpProblems.outcomeId, row.id));
  return { ...row, followUpProblemIds: followUps.map((f) => f.problemId) };
}

/**
 * Evidence for a Problem with each linked Observation (and its archive block),
 * and whether each note was corrected.
 *
 * The marker joins the hop the Observations already cost rather than adding one
 * of its own: wherever an Evidence note is shown, it is shown with the marker
 * (ADR-0017).
 */
async function evidenceWithObservations(db: CruxDb, problemId: number, sortByCreatedAt = false) {
  const evRows = await db.select().from(evidence).where(eq(evidence.problemId, problemId));
  if (sortByCreatedAt) evRows.sort((a, b) => a.createdAt - b.createdAt);
  const obsIds = evRows.map((e) => e.observationId);
  const [obsRows, markers] = await Promise.all([
    obsIds.length
      ? db.select().from(observations).where(inArray(observations.id, obsIds))
      : Promise.resolve([]),
    revisionMarkersFor(db, "evidence"),
  ]);
  const obsById = new Map(obsRows.map((o) => [o.id, o]));
  return evRows.map((e) => {
    const obs = obsById.get(e.observationId);
    return {
      ...e,
      revision: markers.get(e.id) ?? null,
      observation: obs ? { ...obs, archive: toArchive(obs) } : null,
    };
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
  scope: Scope,
): Promise<SearchResults> {
  const ws = q.workstream ? await requireWorkstreamInScope(db, q.workstream, scope) : null;
  const limit = q.limit ?? SEARCH_DEFAULT_LIMIT;
  // Narrowing to one Workstream is the caller's option; narrowing to the ones
  // this Principal owns is not. An unfiltered search is the read most likely to
  // surface somebody else's words, so the tenancy predicate is applied to both
  // halves whether or not `--workstream` was given.
  const scoped = (workstreamColumn: SQLiteColumn, match: ReturnType<typeof substringMatch>) =>
    ws
      ? and(eq(workstreamColumn, ws.id), match)
      : and(inArray(workstreamColumn, scope.workstreamIds), match);

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

  // Archived Observations are out unless asked for, which makes this search
  // weaker on purpose: a retired row no longer surfaces to the search an agent
  // runs before filing, so a near-duplicate Observation gets likelier.
  // Duplication among Observations is cheap and by design; a stale row quietly
  // informing a live conclusion is the failure that has already happened
  // (ADR-0017).
  const observationRows = await db
    .select()
    .from(observations)
    .where(
      and(
        scoped(observations.workstreamId, substringMatch(observations.content, q.q)),
        liveOnly(q.showArchived),
      ),
    )
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

async function unlinkedObservations(
  db: CruxDb,
  workstreamId: string,
  showArchived: boolean,
  scope: Scope,
) {
  const rows = await db
    .select()
    .from(observations)
    .where(and(eq(observations.workstreamId, workstreamId), liveOnly(showArchived)));
  // "Linked" means linked to a Problem this Principal can see. The scan stays
  // unfiltered by Observation — an `inArray` over every Observation id in the
  // Workstream is the parameter limit this deployment would hit first — and is
  // narrowed on the Problem side instead, where the id list is the Workstream
  // set and therefore small.
  const linked = new Set(
    (
      await db
        .select({ id: evidence.observationId })
        .from(evidence)
        .where(inArray(evidence.problemId, problemsInScope(db, scope)))
    ).map((r) => r.id),
  );
  return rows.filter((o) => !linked.has(o.id)).map((o) => ({ ...o, archive: toArchive(o) }));
}

// ---------------------------------------------------------------------------
// query()
// ---------------------------------------------------------------------------

/**
 * Everything a read needs: the corpus, who is asking, and what they may see.
 *
 * A caller that resolves a Principal's scope once and then performs several
 * reads carries this rather than the three separately — passing it to `query()`
 * is what keeps the scope from being resolved again per read. It exists as a
 * type so a page cannot hold the first two and forget the third: leaving the
 * scope out is safe but is a round trip, and this makes the omission visible at
 * the call site rather than invisible in the latency.
 */
export type ReadContext = {
  db: CruxDb;
  principal: Principal;
  scope: Scope;
};

/**
 * Run a named read, scoped to the Principal that asked for it.
 *
 * `principal` is required, not optional: an optional scope is one a caller can
 * forget, and the thing a caller forgetting it produces is a cross-tenant
 * disclosure. It must come from the server's own resolution of the request —
 * a bearer token or a browser session — never from the request body, which the
 * client controls.
 *
 * Throws `NotFoundError` for a missing entity a command requires, exactly as
 * before, so the error envelope and the CLI's exit code are unchanged. A row
 * outside the scope is reported as missing rather than as forbidden.
 */
/**
 * Somewhere to put work the answer does not depend on — the `recentQueries`
 * write, which is two sequential hops to a Durable Object the caller was paying
 * for after the result already existed.
 *
 * It is a callback rather than an import because core must not name a runtime
 * (ADR-0003): the Worker passes `ctx.waitUntil`, and a caller with no execution
 * context passes nothing and keeps the awaited behaviour, which is what keeps
 * the suites deterministic — you can assert that a `defer` was called, and you
 * cannot assert that `waitUntil` was. The work handed over never rejects, so it
 * is safe for `waitUntil`.
 */
export type Defer = (work: Promise<unknown>) => void;

export async function query(
  rawQuery: unknown,
  options: {
    db: CruxDb;
    principal: Principal;
    viewStore?: ViewStore;
    /** An already-resolved scope for this same Principal, when the caller has
     * one. The API resolves identity and scope in a single statement at the
     * edge, and handing it down is what keeps that one round trip from becoming
     * two. Omitting it resolves the scope here — never runs unscoped — and a
     * scope belonging to somebody else is ignored rather than trusted. */
    scope?: Scope;
    /** Hand off work the answer does not depend on — see `Defer`. */
    defer?: Defer;
  },
): Promise<unknown> {
  const q = QuerySchema.parse(rawQuery);
  const { db } = options;

  const result = await run(q, db, await scopeFor(db, options.principal, options.scope));

  const record = RECORDED[q.kind];
  if (record && options.viewStore) {
    // Started here either way — `defer` changes who waits for it, not when it
    // begins. It stays a read-modify-write over the whole blob, so two recorded
    // reads in flight at once can still lose an entry; that was true awaited
    // and it is bookkeeping, not corpus.
    const written = recordRecentQuery(
      options.viewStore,
      record.kind,
      (record.slug as (x: unknown) => string)(q),
    );
    if (options.defer) options.defer(written);
    else await written;
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

async function run(q: QueryRequest, db: CruxDb, scope: Scope): Promise<unknown> {
  switch (q.kind) {
    case "WORKSTREAM_LIST":
      return db.select().from(workstreams).where(inArray(workstreams.id, scope.workstreamIds));

    case "WORKSTREAM_SHOW": {
      // One wave: the marker keys on the id the caller already named, so it
      // does not wait on the row it decorates (ADR-0017).
      const [rows, revision] = await Promise.all([
        db.select().from(workstreams).where(eq(workstreams.id, q.id)).limit(1),
        revisionMarkerFor(db, "workstream", q.id),
      ]);
      if (rows.length === 0 || !scope.has(rows[0]!.id)) {
        throw new NotFoundError(`workstream not found: ${q.id}`, { id: q.id });
      }
      return { ...rows[0]!, revision };
    }

    case "WORKSTREAM_REVISIONS": {
      const ws = await requireWorkstreamInScope(db, q.id, scope);
      return (await revisionsFor(db, "workstream", ws.id)) satisfies RevisionEntry[];
    }

    case "WORKSTREAM_GET": {
      const rows = await db.select().from(workstreams).where(eq(workstreams.id, q.id)).limit(1);
      const row = rows[0];
      return row && scope.has(row.id) ? row : null;
    }

    case "WORKSTREAM_BY_SLUG": {
      // Scoped before the row is picked, not after: slugs are unique per owner,
      // so an unscoped lookup could answer with a stranger's row — or answer
      // null while the caller's own Workstream of that name sits behind it.
      return (await findWorkstreamBySlugInScope(db, q.slug, scope)) ?? null;
    }

    case "WORKSTREAM_SUMMARIES": {
      const wsRows = await db
        .select()
        .from(workstreams)
        .where(inArray(workstreams.id, scope.workstreamIds));
      const allProblems = await db
        .select()
        .from(problems)
        .where(inArray(problems.workstreamId, scope.workstreamIds));
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
      const ws = await requireWorkstreamInScope(db, q.workstream, scope);
      const rows = await db
        .select()
        .from(observations)
        .where(and(eq(observations.workstreamId, ws.id), liveOnly(q.showArchived)));
      // The archive block rides along even here, where the rows are otherwise
      // raw: an archived row is only ever shown because somebody asked for it,
      // and what they need to see with it is why it was retired.
      return rows.map((o) => ({ ...o, archive: toArchive(o) }) satisfies ObservationWithArchive);
    }

    case "OBSERVATION_SHOW": {
      // One wave, not two: both statements need the id and nothing else, and
      // the marker joins the read rather than costing a hop after it
      // (ADR-0017). The marker query touches no tenant-bearing column, so
      // issuing it before the scope check rejects tells a stranger nothing.
      const [rows, revision] = await Promise.all([
        db.select().from(observations).where(eq(observations.id, q.id)).limit(1),
        revisionMarkerFor(db, "observation", q.id),
      ]);
      if (rows.length === 0 || !scope.has(rows[0]!.workstreamId)) {
        throw new NotFoundError(`observation not found: ${q.id}`, { id: q.id });
      }
      // The marker, and only the marker: what it used to say is the second
      // read below (ADR-0017).
      return { ...rows[0]!, revision } satisfies ObservationWithRevision;
    }

    case "OBSERVATION_REVISIONS": {
      // The scope check is the whole of the authorization: history about an
      // Observation this Principal cannot see is one that does not exist.
      const rows = await db
        .select({ workstreamId: observations.workstreamId })
        .from(observations)
        .where(eq(observations.id, q.id))
        .limit(1);
      if (rows.length === 0 || !scope.has(rows[0]!.workstreamId)) {
        throw new NotFoundError(`observation not found: ${q.id}`, { id: q.id });
      }
      return (await revisionsFor(db, "observation", q.id)) satisfies RevisionEntry[];
    }

    case "OBSERVATION_DETAIL": {
      // The marker rides the statement that fetches the row, exactly as it does
      // in `OBSERVATION_SHOW`: the page that renders it must not pay a hop for
      // it (ADR-0017). It touches no tenant-bearing column, so issuing it
      // before the scope check below tells a stranger nothing.
      const [rows, revision] = await Promise.all([
        db.select().from(observations).where(eq(observations.id, q.id)).limit(1),
        revisionMarkerFor(db, "observation", q.id),
      ]);
      const obs = rows[0];
      if (!obs || !scope.has(obs.workstreamId)) return null;
      const evRows = await db
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.observationId, q.id),
            inArray(evidence.problemId, problemsInScope(db, scope)),
          ),
        );
      const probIds = evRows.map((e) => e.problemId);
      // The marker rides the hop the Problems already cost, for the same reason
      // it rides the Observations in `evidenceWithObservations`.
      const [probRows, markers] = await Promise.all([
        probIds.length
          ? db.select().from(problems).where(inArray(problems.id, probIds))
          : Promise.resolve([]),
        revisionMarkersFor(db, "evidence"),
      ]);
      const probById = new Map(probRows.map((p) => [p.id, p]));
      const evidenceLinks = evRows
        .map((e) => ({
          ...e,
          revision: markers.get(e.id) ?? null,
          problem: probById.get(e.problemId)!,
        }))
        .filter((e) => e.problem);
      return {
        observation: { ...obs, archive: toArchive(obs) },
        evidenceLinks,
        revision,
      } satisfies ObservationDetail;
    }

    case "OBSERVATION_UNLINKED": {
      const wsId = (await requireWorkstreamInScope(db, q.workstreamId, scope)).id;
      const rows = await unlinkedObservations(db, wsId, Boolean(q.showArchived), scope);
      return [...rows].sort((a, b) => b.createdAt - a.createdAt);
    }

    case "OBSERVATION_SUMMARIES": {
      const wsId = (await requireWorkstreamInScope(db, q.workstreamId, scope)).id;
      const rows = await db
        .select()
        .from(observations)
        .where(and(eq(observations.workstreamId, wsId), liveOnly(q.showArchived)));
      // Every Evidence row this Principal can see, unfiltered by Observation —
      // the same shape `unlinkedObservations` uses above, and for the same
      // reason: the alternative is an `inArray` over every Observation id in the
      // Workstream, which is the parameter limit this deployment would hit first.
      const ev = await db
        .select({ observationId: evidence.observationId })
        .from(evidence)
        .where(inArray(evidence.problemId, problemsInScope(db, scope)));
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
      const ws = await requireWorkstreamInScope(db, q.workstream, scope);
      const where =
        q.status === "unscheduled"
          ? and(eq(problems.workstreamId, ws.id), isNull(problems.status))
          : q.status
            ? and(eq(problems.workstreamId, ws.id), eq(problems.status, q.status))
            : eq(problems.workstreamId, ws.id);
      return db.select().from(problems).where(where);
    }

    case "PROBLEM_GET":
      return findProblemInScope(db, q.id, scope);

    case "PROBLEM_SHOW": {
      const p = await requireProblemInScope(db, q.id, scope);
      // One wave, not three: all three need the Problem's id and nothing else,
      // and the revision marker joins it rather than costing a round trip after
      // it (ADR-0017). `read-round-trips.workerd.ts` is what holds this.
      const [attemptRows, outcome, revision] = await Promise.all([
        attemptsFor(db, p.id),
        outcomeFor(db, p.id),
        revisionMarkerFor(db, "problem", p.id),
      ]);
      return { ...p, attempts: attemptRows, outcome, revision };
    }

    case "PROBLEM_REVISIONS": {
      // The scope check is the whole of the authorization: history about a
      // Problem this Principal cannot see is a Problem that does not exist.
      const p = await requireProblemInScope(db, q.id, scope);
      return (await revisionsFor(db, "problem", p.id)) satisfies RevisionEntry[];
    }

    case "PROBLEM_SUMMARIES": {
      const wsId = (await requireWorkstreamInScope(db, q.workstreamId, scope)).id;
      const rows = await db.select().from(problems).where(eq(problems.workstreamId, wsId));
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const ev = await db
        .select({ problemId: evidence.problemId })
        .from(evidence)
        .where(inArray(evidence.problemId, ids));
      const evCount = new Map<number, number>();
      for (const e of ev) evCount.set(e.problemId, (evCount.get(e.problemId) ?? 0) + 1);
      // Attempt counts are what a summary row says about how far a Problem got:
      // `attemptCount` distinguishes one nobody ever touched from one that was
      // worked on and stopped, and `openAttemptCount` is the drift signal — a
      // Problem staged as active with zero open Attempts.
      const att = await attemptTallies(db, ids);
      return rows
        .map(
          (r) =>
            ({
              ...r,
              evidenceCount: evCount.get(r.id) ?? 0,
              attemptCount: att.total.get(r.id) ?? 0,
              openAttemptCount: att.open.get(r.id) ?? 0,
            }) satisfies ProblemSummary,
        )
        .sort((a, b) => {
          const d = rankStatus(a.status) - rankStatus(b.status);
          return d !== 0 ? d : a.createdAt - b.createdAt;
        });
    }

    case "PROBLEM_DETAIL": {
      const problemId = numeric(q.id);
      const p = await findProblemInScope(db, problemId, scope);
      if (!p) return null;
      // Everything below needs only `problemId`, which the scope check above
      // already established. Awaiting them one at a time — which is what
      // building the object literal in order did — spent five sequential round
      // trips on five independent reads. Two of them still contain a necessary
      // second hop of their own (the Observations behind the Evidence, the
      // follow-up Problems an Outcome names), so the floor here is the depth of
      // the deepest one, not the sum of all five.
      const [attemptRows, evidenceRows, abandonRows, outcome, revision] = await Promise.all([
        attemptsFor(db, problemId),
        evidenceWithObservations(db, problemId, true),
        db.select().from(abandonments).where(eq(abandonments.problemId, problemId)).limit(1),
        outcomeFor(db, problemId),
        // Five rather than four, and still one wave: the marker the page shows
        // is a fifth independent question, not a hop after the other four
        // (ADR-0017).
        revisionMarkerFor(db, "problem", problemId),
      ]);
      return {
        problem: p,
        attempts: attemptRows,
        evidence: evidenceRows,
        abandonment: abandonRows[0] ?? null,
        outcome,
        revision,
      } satisfies ProblemDetail;
    }

    case "EVIDENCE_LIST": {
      const rows =
        q.problem !== undefined
          ? await db
              .select()
              .from(evidence)
              .where(eq(evidence.problemId, (await requireProblemInScope(db, q.problem, scope)).id))
          : // No Problem named: every Evidence row whose Problem is inside the scope.
            await db
              .select()
              .from(evidence)
              .where(inArray(evidence.problemId, problemsInScope(db, scope)));
      // One grouped statement for the whole page, not one per row (ADR-0017).
      const markers = await revisionMarkersFor(db, "evidence");
      return rows.map(
        (r) => ({ ...r, revision: markers.get(r.id) ?? null }) satisfies EvidenceWithRevision,
      );
    }

    case "EVIDENCE_REVISIONS": {
      const row = await requireEvidenceInScope(db, q.id, scope);
      return (await revisionsFor(db, "evidence", row.id)) satisfies RevisionEntry[];
    }

    case "ATTEMPT_LIST": {
      const rows =
        q.problem !== undefined
          ? await db
              .select()
              .from(attempts)
              .where(eq(attempts.problemId, (await requireProblemInScope(db, q.problem, scope)).id))
          : await db
              .select()
              .from(attempts)
              .where(inArray(attempts.problemId, problemsInScope(db, scope)));
      const sorted = [...rows].sort(byFiledOrder);
      // `attempt list` is where an Attempt is shown, so it is where the marker
      // goes — one grouped statement for the whole listing, not one per row.
      const markers = sorted.length
        ? await revisionMarkersFor(db, "attempt")
        : new Map<string, RevisionMarker>();
      return sorted.map((a) => ({
        ...a,
        revision: markers.get(a.id) ?? null,
      })) satisfies AttemptListRow[];
    }

    case "ATTEMPT_REVISIONS": {
      // Scoped through the Attempt's Problem, as every other Attempt read is.
      await requireAttemptInScope(db, q.id, scope);
      return (await revisionsFor(db, "attempt", q.id)) satisfies RevisionEntry[];
    }

    case "PROBLEM_DRIFT": {
      // Drift: a Problem staged as active with zero *open* Attempts. A closed
      // Attempt is history, not work in flight, so a Problem whose only Attempt
      // shipped or was dropped has drifted again (ADR-0012).
      const ws = await requireWorkstreamInScope(db, q.workstream, scope);
      const stages = q.stages?.length ? q.stages : ["now"];
      // Only a Problem still on the board can drift: `done` and `abandoned`
      // left through a door that demanded a reason, and `unscheduled` was never
      // claimed to be active in the first place.
      for (const s of stages) {
        if (!(ACTIVE_STAGES as readonly string[]).includes(s)) {
          throw new ValidationError(
            `Invalid drift stage: "${s}". Valid values: ${ACTIVE_STAGES.join(", ")}`,
            { stage: s },
          );
        }
      }
      const rows = await db
        .select()
        .from(problems)
        .where(and(eq(problems.workstreamId, ws.id), inArray(problems.status, stages)));
      if (rows.length === 0) return [];
      const { total, open } = await attemptTallies(
        db,
        rows.map((r) => r.id),
      );
      return rows
        .filter((r) => !open.has(r.id))
        .map((r) => ({ ...r, attemptCount: total.get(r.id) ?? 0 }) satisfies DriftingProblem)
        .sort((a, b) => {
          const d = rankStatus(a.status) - rankStatus(b.status);
          return d !== 0 ? d : a.createdAt - b.createdAt;
        });
    }

    case "ABANDONMENT_LIST": {
      const ws = await requireWorkstreamInScope(db, q.workstream, scope);
      const wsProblems = await db
        .select({ id: problems.id })
        .from(problems)
        .where(eq(problems.workstreamId, ws.id));
      const problemIds = wsProblems.map((p) => p.id);
      if (problemIds.length === 0) return [];
      return db.select().from(abandonments).where(inArray(abandonments.problemId, problemIds));
    }

    case "ABANDONMENT_SHOW": {
      // Same wave, same reason as WORKSTREAM_SHOW: the marker keys on `q.id`.
      const [rows, revision] = await Promise.all([
        db
          .select()
          .from(abandonments)
          .where(
            and(
              eq(abandonments.id, q.id),
              inArray(abandonments.problemId, problemsInScope(db, scope)),
            ),
          )
          .limit(1),
        revisionMarkerFor(db, "abandonment", q.id),
      ]);
      if (rows.length === 0)
        throw new NotFoundError(`abandonment not found: ${q.id}`, { id: q.id });
      return { ...rows[0]!, revision };
    }

    case "ABANDONMENT_REVISIONS": {
      const row = await requireAbandonmentInScope(db, q.id, scope);
      return (await revisionsFor(db, "abandonment", row.id)) satisfies RevisionEntry[];
    }

    case "OUTCOME_LIST":
      return db
        .select()
        .from(outcomes)
        .where(inArray(outcomes.problemId, problemsInScope(db, scope)));

    case "OUTCOME_SHOW": {
      const rows = await db
        .select()
        .from(outcomes)
        .where(and(eq(outcomes.id, q.id), inArray(outcomes.problemId, problemsInScope(db, scope))))
        .limit(1);
      if (rows.length === 0) throw new NotFoundError(`outcome not found: ${q.id}`, { id: q.id });
      // One wave: the follow-ups and the marker both need only the id.
      const [followUps, revision] = await Promise.all([
        db
          .select({ problemId: outcomeFollowUpProblems.problemId })
          .from(outcomeFollowUpProblems)
          .where(eq(outcomeFollowUpProblems.outcomeId, q.id)),
        revisionMarkerFor(db, "outcome", q.id),
      ]);
      return {
        ...rows[0]!,
        followUpProblemIds: followUps.map((f) => f.problemId),
        revision,
      };
    }

    case "OUTCOME_REVISIONS": {
      const row = await requireOutcomeInScope(db, q.id, scope);
      return (await revisionsFor(db, "outcome", row.id)) satisfies RevisionEntry[];
    }

    case "SEARCH":
      return searchCorpus(db, q, scope);
  }
}
