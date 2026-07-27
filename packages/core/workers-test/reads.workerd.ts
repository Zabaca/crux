import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { query } from "../src/reads/index.js";
import { MemoryViewStore } from "../src/view-state/store.js";
import {
  evidence,
  observations,
  problems,
  solutions,
  users,
  workstreams,
} from "../src/db/schema.js";

// Seam: `query(request, { db })` — the single read entry point. It runs here
// rather than under bun for the same reason the transitions do (ADR-0006): the
// shapes these tests pin are shapes D1 has to produce inside workerd.
//
// Expected values come from the CLI contract the skill instructions depend on:
// `crux context --json` emits a `workstream` + per-stage problem buckets, each
// problem carrying `evidence`, `solutions`, `latest_decision`, `eliminations`,
// `abandonment` and `legal_next_transitions`.

let db: CruxDb;

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
  await db.insert(solutions).values({ problemId: p!.id, title: "S", createdById: "USR-t" });
  return { problemId: p!.id };
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
});

describe("query()", () => {
  test("rejects a kind it does not serve", async () => {
    await expect(query({ kind: "DROP_EVERYTHING" }, { db })).rejects.toThrow();
  });

  test("WORKSTREAM_SHOW is NOT_FOUND for a missing workstream", async () => {
    await expect(query({ kind: "WORKSTREAM_SHOW", id: "WS-nope" }, { db })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("PROBLEM_SHOW inlines solutions and the latest decision", async () => {
    const { problemId } = await seed();
    const shown = (await query({ kind: "PROBLEM_SHOW", id: problemId }, { db })) as {
      id: number;
      solutions: unknown[];
      latest_decision: unknown;
    };
    expect(shown.id).toBe(problemId);
    expect(shown.solutions).toHaveLength(1);
    expect(shown.latest_decision).toBeNull();
  });

  test("CONTEXT emits the digest shape a fresh session reloads from", async () => {
    await seed();
    const digest = (await query(
      { kind: "CONTEXT", workstream: "t", stages: ["unscheduled"], includeExtras: true },
      { db },
    )) as Record<string, any>;

    expect(digest.workstream.slug).toBe("t");
    expect(Object.keys(digest)).toEqual([
      "workstream",
      "seed_version",
      "unscheduled",
      "recent_observations_unlinked",
    ]);
    const p = digest.unscheduled[0];
    expect(p.evidence[0].observation.content).toBe("users lose context overnight");
    expect(p.solutions).toHaveLength(1);
    expect(p.latest_decision).toBeNull();
    expect(p.eliminations).toEqual([]);
    expect(p.abandonment).toBeNull();
    // No status yet, and nothing shipped: schedule or abandon, nothing else.
    expect(p.legal_next_transitions).toEqual(["schedule", "abandon"]);
    // OBS-1 is linked as evidence, so it is not in the unlinked queue.
    expect(digest.recent_observations_unlinked).toEqual([]);
  });

  test("CONTEXT rejects a stage bucket that does not exist", async () => {
    await seed();
    await expect(
      query({ kind: "CONTEXT", workstream: "t", stages: ["someday"] }, { db }),
    ).rejects.toThrow(/Invalid stage value/);
  });

  test("a recorded read leaves a trace in recentQueries", async () => {
    const { problemId } = await seed();
    const store = new MemoryViewStore();
    await query({ kind: "PROBLEM_SHOW", id: problemId }, { db, viewStore: store });
    const blob = (await store.read()) as { recentQueries: Array<{ kind: string; slug: string }> };
    expect(blob.recentQueries.map((q) => [q.kind, q.slug])).toEqual([
      ["PROBLEM_SHOW", String(problemId)],
    ]);
  });

  test("an unrecorded read leaves none", async () => {
    const store = new MemoryViewStore();
    await query({ kind: "WORKSTREAM_LIST" }, { db, viewStore: store });
    expect(await store.read()).toEqual({});
  });
});
