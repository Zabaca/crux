import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";
import { inArray } from "drizzle-orm";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import {
  query,
  type ObservationDetail,
  type ProblemDetail,
  type SearchResults,
} from "../src/reads/index.js";
import { MemoryViewStore } from "../src/view-state/store.js";
import {
  attempts,
  evidence,
  observations,
  problems,
  users,
  workstreams,
} from "../src/db/schema.js";

// Seam: `query(request, { db, principal })` — the single read entry point. It runs here
// rather than under bun for the same reason the transitions do (ADR-0006): the
// shapes these tests pin are shapes D1 has to produce inside workerd.
//
// Expected values come from the CLI contract the skill instructions depend on:
// the flat reads an agent walks to get warm — `WORKSTREAM_LIST` to choose,
// `PROBLEM_LIST`/`PROBLEM_SUMMARIES` to see the field, `PROBLEM_DETAIL` to drill
// into the two or three that matter, each carrying `evidence`, `attempts`,
// `abandonment` and `outcome`.

let db: CruxDb;

// Every read is scoped to the Principal that asked (ADR-0013), and the seed
// below files everything under `USR-t`, so that is who these tests read as.
// The cross-tenant half — what a *different* Principal sees — is
// `scoping.workerd.ts`.
const principal = { id: "USR-t" };

async function seed(): Promise<{ problemId: number }> {
  await db.insert(users).values({ id: "USR-t", slug: "t", name: "T" });
  await db.insert(workstreams).values({ id: "WS-t", slug: "t", title: "T", ownerId: "USR-t" });
  await db.insert(observations).values({
    id: "OBS-1",
    workstreamId: "WS-t",
    reporterId: "USR-t",
    content: "users lose context overnight",
  });
  const [p] = await db
    .insert(problems)
    .values({ workstreamId: "WS-t", title: "P", description: "D", createdById: "USR-t" })
    .returning({ id: problems.id });
  await db.insert(evidence).values({
    id: "EVD-1",
    observationId: "OBS-1",
    problemId: p!.id,
    note: "why",
    createdById: "USR-t",
  });
  await db.insert(attempts).values({
    id: "ATT-001",
    problemId: p!.id,
    ref: "https://tracker.example/1",
    label: "spike",
    createdById: "USR-t",
  });
  return { problemId: p!.id };
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

describe("query()", () => {
  test("rejects a kind it does not serve", async () => {
    await expect(query({ kind: "DROP_EVERYTHING" }, { db, principal })).rejects.toThrow();
  });

  test("WORKSTREAM_SHOW is NOT_FOUND for a missing workstream", async () => {
    await expect(
      query({ kind: "WORKSTREAM_SHOW", id: "WS-nope" }, { db, principal }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("PROBLEM_SHOW inlines the Attempts and the Outcome", async () => {
    const { problemId } = await seed();
    const shown = (await query({ kind: "PROBLEM_SHOW", id: problemId }, { db, principal })) as {
      id: number;
      attempts: Array<{ id: string; ref: string }>;
      outcome: unknown;
    };
    expect(shown.id).toBe(problemId);
    expect(shown.attempts).toHaveLength(1);
    expect(shown.attempts[0]).toMatchObject({ id: "ATT-001", ref: "https://tracker.example/1" });
    expect(shown.outcome).toBeNull();
  });

  test("PROBLEM_DETAIL inlines the Evidence with its Observation", async () => {
    const { problemId } = await seed();
    const detail = (await query({ kind: "PROBLEM_DETAIL", id: problemId }, { db, principal })) as {
      problem: { id: number };
      evidence: Array<{ note: string; observation: { content: string } }>;
      attempts: unknown[];
      abandonment: unknown;
      outcome: unknown;
    };
    expect(detail.problem.id).toBe(problemId);
    expect(detail.evidence[0]!.observation.content).toBe("users lose context overnight");
    expect(detail.attempts).toHaveLength(1);
    expect(detail.abandonment).toBeNull();
    expect(detail.outcome).toBeNull();
  });

  test("OBSERVATION_UNLINKED omits an Observation already linked as Evidence", async () => {
    await seed(); // OBS-1 is Evidence for the seeded Problem.
    await db.insert(observations).values({
      id: "OBS-2",
      workstreamId: "WS-t",
      reporterId: "USR-t",
      content: "nobody has triaged this one",
    });
    const unlinked = (await query(
      { kind: "OBSERVATION_UNLINKED", workstreamId: "t" },
      { db, principal },
    )) as Array<{ id: string }>;
    expect(unlinked.map((o) => o.id)).toEqual(["OBS-2"]);
  });

  test("OBSERVATION_UNLINKED hides an archived Observation unless asked for it", async () => {
    await seed();
    await db.insert(observations).values([
      { id: "OBS-2", workstreamId: "WS-t", reporterId: "USR-t", content: "still open intake" },
      {
        id: "OBS-3",
        workstreamId: "WS-t",
        reporterId: "USR-t",
        content: "ruled out",
        archivedAt: 1700,
        archivedById: "USR-t",
        archiveRationale: "misfiled",
      },
    ]);

    const hidden = (await query(
      { kind: "OBSERVATION_UNLINKED", workstreamId: "t" },
      { db, principal },
    )) as Array<{ id: string }>;
    expect(hidden.map((o) => o.id)).toEqual(["OBS-2"]);

    const shown = (await query(
      { kind: "OBSERVATION_UNLINKED", workstreamId: "t", showArchived: true },
      { db, principal },
    )) as Array<{ id: string; archive: { rationale: string | null } | null }>;
    expect(shown.map((o) => o.id).sort()).toEqual(["OBS-2", "OBS-3"]);
    expect(shown.find((o) => o.id === "OBS-3")!.archive).toMatchObject({ rationale: "misfiled" });
  });

  test("a recorded read leaves a trace in recentQueries", async () => {
    const { problemId } = await seed();
    const store = new MemoryViewStore();
    await query({ kind: "PROBLEM_SHOW", id: problemId }, { db, principal, viewStore: store });
    const blob = (await store.read()) as { recentQueries: Array<{ kind: string; slug: string }> };
    expect(blob.recentQueries.map((q) => [q.kind, q.slug])).toEqual([
      ["PROBLEM_SHOW", String(problemId)],
    ]);
  });

  test("with a defer, the recorded write is handed over rather than waited for", async () => {
    const { problemId } = await seed();
    const store = new MemoryViewStore();
    const deferred: Array<Promise<unknown>> = [];
    // A store that does not answer until it is released — standing in for the
    // Durable Object hop, which is the ~205ms the caller used to pay for after
    // the answer already existed. An in-memory store settles in a microtask and
    // so cannot tell "handed over" from "waited for".
    let release = (): void => {};
    const slow = {
      read: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return store.read();
      },
      write: (blob: Record<string, unknown>) => store.write(blob),
    };

    await query(
      { kind: "PROBLEM_SHOW", id: problemId },
      { db, principal, viewStore: slow, defer: (work) => deferred.push(work) },
    );

    // The read has answered while the store is still mid-hop.
    expect(deferred).toHaveLength(1);
    expect(await store.read()).toEqual({});

    release();
    await deferred[0]!;
    const blob = (await store.read()) as { recentQueries: Array<{ kind: string; slug: string }> };
    expect(blob.recentQueries.map((q) => [q.kind, q.slug])).toEqual([
      ["PROBLEM_SHOW", String(problemId)],
    ]);
  });

  test("a deferred write that fails neither rejects nor fails the read", async () => {
    const { problemId } = await seed();
    const broken = {
      read: () => Promise.reject(new Error("the object is unreachable")),
      write: () => Promise.reject(new Error("the object is unreachable")),
    };
    const deferred: Array<Promise<unknown>> = [];

    const result = await query(
      { kind: "PROBLEM_SHOW", id: problemId },
      { db, principal, viewStore: broken, defer: (work) => deferred.push(work) },
    );

    expect((result as { id: number }).id).toBe(problemId);
    // Handing a rejecting promise to `waitUntil` is an unhandled rejection in
    // the Worker, so the best-effort guarantee has to survive the deferral.
    await expect(deferred[0]!).resolves.toBeUndefined();
  });

  test("OBSERVATION_SUMMARIES derives the three states an Observation can be in", async () => {
    await seed(); // OBS-1 is Evidence for the seeded Problem.
    await db.insert(observations).values([
      { id: "OBS-2", workstreamId: "WS-t", reporterId: "USR-t", content: "nobody has read me" },
      {
        id: "OBS-3",
        workstreamId: "WS-t",
        reporterId: "USR-t",
        content: "ruled out",
        archivedAt: 1,
        archivedById: "USR-t",
        archiveRationale: "duplicate of OBS-1",
      },
    ]);

    // The intake page is the one caller that asks for archived rows, because
    // its Archived group is one of the three states this test names.
    const rows = (await query(
      { kind: "OBSERVATION_SUMMARIES", workstreamId: "WS-t", showArchived: true },
      { db, principal },
    )) as Array<{ id: string; problemCount: number; archive: unknown }>;
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Used: Evidence for one Problem, and no `status` column said so.
    expect(byId.get("OBS-1")?.problemCount).toBe(1);
    expect(byId.get("OBS-1")?.archive).toBeNull();
    // Waiting: neither linked nor ruled out — the intake queue.
    expect(byId.get("OBS-2")?.problemCount).toBe(0);
    expect(byId.get("OBS-2")?.archive).toBeNull();
    // Ruled out: archived carries the recorded judgment, and stays at zero.
    expect(byId.get("OBS-3")?.problemCount).toBe(0);
    expect(byId.get("OBS-3")?.archive).toMatchObject({ rationale: "duplicate of OBS-1" });
  });

  test("OBSERVATION_SUMMARIES counts every Problem an Observation feeds", async () => {
    await seed(); // OBS-1 is Evidence for the seeded Problem.
    const [p2] = await db
      .insert(problems)
      .values({ workstreamId: "WS-t", title: "P2", description: "D", createdById: "USR-t" })
      .returning({ id: problems.id });
    await db.insert(evidence).values({
      id: "EVD-2",
      observationId: "OBS-1",
      problemId: p2!.id,
      note: "also",
      createdById: "USR-t",
    });

    const rows = (await query(
      { kind: "OBSERVATION_SUMMARIES", workstreamId: "WS-t" },
      { db, principal },
    )) as Array<{ id: string; problemCount: number }>;
    expect(rows.find((r) => r.id === "OBS-1")?.problemCount).toBe(2);
  });

  test("an unrecorded read leaves none", async () => {
    const store = new MemoryViewStore();
    await query({ kind: "WORKSTREAM_LIST" }, { db, principal, viewStore: store });
    expect(await store.read()).toEqual({});
  });
});

// An archive is the recorded judgment that a row has stopped being live
// (ADR-0017). The write side stored it; until now only the unlinked queue read
// it, so every other listing handed a retired row back as though it were still
// current — which is how one silently informed a live conclusion. What follows
// is the line: listings and search drop archived rows, naming one still returns
// it, and an Evidence link still carries it.
describe("archiving is honoured on read", () => {
  /** OBS-1 is Evidence for the seeded Problem; both Observations are archived. */
  async function seedArchived(): Promise<{ problemId: number }> {
    const seeded = await seed();
    await db.insert(observations).values({
      id: "OBS-2",
      workstreamId: "WS-t",
      reporterId: "USR-t",
      content: "an unlinked note that lost its context",
    });
    await db
      .update(observations)
      .set({ archivedAt: 1700, archivedById: "USR-t", archiveRationale: "the product changed" })
      .where(inArray(observations.id, ["OBS-1", "OBS-2"]));
    return seeded;
  }

  test("OBSERVATION_LIST leaves archived rows out, and hands them back when asked", async () => {
    await seedArchived();
    const listed = (await query(
      { kind: "OBSERVATION_LIST", workstream: "t" },
      { db, principal },
    )) as Array<{ id: string }>;
    expect(listed).toEqual([]);

    const shown = (await query(
      { kind: "OBSERVATION_LIST", workstream: "t", showArchived: true },
      { db, principal },
    )) as Array<{ id: string; archive: { rationale: string | null } | null }>;
    expect(shown.map((o) => o.id).sort()).toEqual(["OBS-1", "OBS-2"]);
    // Shown only because somebody asked, so the reason it was retired comes with it.
    expect(shown[0]!.archive).toMatchObject({
      rationale: "the product changed",
      archivedById: "USR-t",
      archivedAt: 1700,
    });
  });

  test("OBSERVATION_SUMMARIES leaves archived rows out, and hands them back when asked", async () => {
    await seedArchived();
    const summarised = (await query(
      { kind: "OBSERVATION_SUMMARIES", workstreamId: "WS-t" },
      { db, principal },
    )) as Array<{ id: string }>;
    expect(summarised).toEqual([]);

    const shown = (await query(
      { kind: "OBSERVATION_SUMMARIES", workstreamId: "WS-t", showArchived: true },
      { db, principal },
    )) as Array<{ id: string; problemCount: number }>;
    expect(shown.map((o) => o.id).sort()).toEqual(["OBS-1", "OBS-2"]);
    expect(shown.find((o) => o.id === "OBS-1")!.problemCount).toBe(1);
  });

  test("SEARCH does not match an archived Observation unless asked", async () => {
    await seedArchived();
    const found = (await query(
      { kind: "SEARCH", q: "overnight" },
      { db, principal },
    )) as SearchResults;
    expect(found.observations).toEqual([]);
    // Nothing here narrows Problems — only the Observation half is archived.
    expect(found.problems).toHaveLength(0);

    const shown = (await query(
      { kind: "SEARCH", q: "overnight", showArchived: true },
      { db, principal },
    )) as SearchResults;
    expect(shown.observations.map((o) => o.id)).toEqual(["OBS-1"]);
    expect(shown.observations[0]!.archive).toMatchObject({ rationale: "the product changed" });
  });

  test("naming an archived Observation still returns it", async () => {
    await seedArchived();
    const shown = (await query({ kind: "OBSERVATION_SHOW", id: "OBS-1" }, { db, principal })) as {
      id: string;
      archivedAt: number | null;
    };
    expect(shown.id).toBe("OBS-1");
    expect(shown.archivedAt).toBe(1700);

    const detail = (await query(
      { kind: "OBSERVATION_DETAIL", id: "OBS-1" },
      { db, principal },
    )) as ObservationDetail;
    expect(detail.observation.archive).toMatchObject({ rationale: "the product changed" });
    expect(detail.evidenceLinks).toHaveLength(1);
  });

  test("an archived Observation stays under the Evidence of the Problem it supports", async () => {
    const { problemId } = await seedArchived();
    // Hiding it here would gut the Problem's argument rather than protect it:
    // the Evidence link is a deliberate assertion that this row supports it.
    const detail = (await query(
      { kind: "PROBLEM_DETAIL", id: problemId },
      { db, principal },
    )) as ProblemDetail;
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]!.observation).toMatchObject({
      id: "OBS-1",
      archive: { rationale: "the product changed" },
    });

    const links = (await query(
      { kind: "EVIDENCE_LIST", problem: problemId },
      { db, principal },
    )) as Array<{ observationId: string }>;
    expect(links.map((e) => e.observationId)).toEqual(["OBS-1"]);
  });
});
