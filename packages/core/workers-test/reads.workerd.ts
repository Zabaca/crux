import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { query } from "../src/reads/index.js";
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

  test("a recorded read leaves a trace in recentQueries", async () => {
    const { problemId } = await seed();
    const store = new MemoryViewStore();
    await query({ kind: "PROBLEM_SHOW", id: problemId }, { db, principal, viewStore: store });
    const blob = (await store.read()) as { recentQueries: Array<{ kind: string; slug: string }> };
    expect(blob.recentQueries.map((q) => [q.kind, q.slug])).toEqual([
      ["PROBLEM_SHOW", String(problemId)],
    ]);
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

    const rows = (await query(
      { kind: "OBSERVATION_SUMMARIES", workstreamId: "WS-t" },
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
