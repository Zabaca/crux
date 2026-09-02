import { env, SELF, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "@crux/core/db";
import { applyD1Schema } from "@crux/core/db/d1";
import { mintToken } from "@crux/core/auth";
import { problems, users, workstreams } from "@crux/core/db/schema";

// Seam: the deployed request path. `SELF.fetch` runs the Worker's own `fetch`
// against the bindings wrangler.jsonc declares — a real D1 and a real
// ViewStateDO — so what these tests pin is the contract the CLI talks to, not a
// stand-in for it.

let db: CruxDb;
let token: string;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://crux.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const dispatch = (action: unknown) =>
  call("/v1/dispatch", { method: "POST", body: JSON.stringify(action) });
const query = (q: unknown) => call("/v1/query", { method: "POST", body: JSON.stringify(q) });

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  await db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
  await db.insert(workstreams).values({ id: "WS-crux", slug: "crux", title: "Crux" });
  token = (await mintToken(db, { userId: "USR-james" })).token;
});

describe("GET /health", () => {
  test("round-trips the D1 binding", async () => {
    const res = await SELF.fetch("https://crux.example/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });
});

describe("bearer auth on /v1", () => {
  test("a valid token authenticates", async () => {
    const res = await call("/v1/view");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revision: number }).revision).toBe(0);
  });

  test("an absent token is rejected", async () => {
    const res = await SELF.fetch("https://crux.example/v1/view");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "missing or invalid bearer token" },
    });
  });

  test("an invalid token is rejected", async () => {
    const res = await SELF.fetch("https://crux.example/v1/query", {
      method: "POST",
      headers: { authorization: "Bearer crux_bogus" },
      body: JSON.stringify({ kind: "WORKSTREAM_LIST" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/query — reads", () => {
  test("answers a named read with the shape the CLI prints", async () => {
    const res = await query({ kind: "WORKSTREAM_LIST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: Array<{ id: string; slug: string }> };
    expect(body.result.map((w) => w.id)).toEqual(["WS-crux"]);
  });

  test("a missing entity comes back as NOT_FOUND, not an empty result", async () => {
    const res = await query({ kind: "PROBLEM_SHOW", id: 999 });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("a read kind the server does not serve is a validation error", async () => {
    const res = await query({ kind: "SELECT * FROM users" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  test("the context digest is served whole, over one request", async () => {
    await dispatch({
      kind: "ADD_PROBLEM",
      payload: { workstream: "WS-crux", title: "P", description: "d" },
    });
    const res = await query({ kind: "CONTEXT", workstream: "crux", stages: ["unscheduled"] });
    const { result } = (await res.json()) as { result: Record<string, any> };
    expect(result.workstream.slug).toBe("crux");
    expect(result.unscheduled).toHaveLength(1);
    expect(result.unscheduled[0].legal_next_transitions).toEqual([
      "schedule",
      "abandon",
      "outcome",
    ]);
  });
});

describe("POST /v1/query — SEARCH", () => {
  // Seeded through `dispatch`, not straight into D1, so what the search reads is
  // what the write path actually stores.
  async function seedCorpus() {
    await db.insert(workstreams).values({ id: "WS-farm", slug: "farm", title: "Farm" });
    await dispatch({
      kind: "ADD_PROBLEM",
      payload: {
        workstream: "WS-crux",
        title: "Reauthentication keeps failing",
        description: "Tokens expire mid-session and the CLI says nothing.",
      },
    });
    await dispatch({
      kind: "ADD_PROBLEM",
      payload: {
        workstream: "WS-farm",
        title: "Irrigation schedule drifts",
        description: "The pump forgets its AUTH token after a power cut.",
      },
    });
    await dispatch({
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "James lost his auth token again mid-demo." },
    });
  }

  type Results = {
    query: string;
    problems: Array<{ id: number; title: string; description: string; workstreamSlug: string }>;
    observations: Array<{ id: string; content: string; workstreamSlug: string }>;
  };
  const search = async (q: Record<string, unknown>): Promise<Results> =>
    ((await (await query({ kind: "SEARCH", ...q })).json()) as { result: Results }).result;

  test("returns Problems and Observations with enough of each to judge a duplicate", async () => {
    await seedCorpus();
    const result = await search({ q: "auth" });
    expect(result.query).toBe("auth");
    const crux = result.problems.find((p) => p.title === "Reauthentication keeps failing")!;
    expect(crux.description).toBe("Tokens expire mid-session and the CLI says nothing.");
    expect(crux.workstreamSlug).toBe("crux");
    expect(result.observations.map((o) => o.content)).toEqual([
      "James lost his auth token again mid-demo.",
    ]);
    expect(result.observations[0]!.workstreamSlug).toBe("crux");
  });

  test("matches case-insensitively, inside a word, in a title or a description", async () => {
    await seedCorpus();
    const result = await search({ q: "AUTH" });
    // "Reauthentication" is a title substring; "AUTH token" is only in the other
    // Problem's description — both have to come back.
    expect(result.problems.map((p) => p.workstreamSlug).sort()).toEqual(["crux", "farm"]);
  });

  test("searches every Workstream by default and only one when scoped", async () => {
    await seedCorpus();
    expect((await search({ q: "auth" })).problems).toHaveLength(2);
    const scoped = await search({ q: "auth", workstream: "farm" });
    expect(scoped.problems.map((p) => p.workstreamSlug)).toEqual(["farm"]);
    expect(scoped.observations).toEqual([]);
  });

  test("a wildcard in the query is a literal, not a pattern", async () => {
    await seedCorpus();
    expect((await search({ q: "%" })).problems).toEqual([]);
    await dispatch({
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "conversion is stuck at 40% flat" },
    });
    const literal = await search({ q: "40%" });
    expect(literal.observations.map((o) => o.content)).toEqual(["conversion is stuck at 40% flat"]);
  });

  test("an unknown workstream is NOT_FOUND, and an empty query is refused", async () => {
    const missing = await query({ kind: "SEARCH", q: "auth", workstream: "nope" });
    expect(missing.status).toBe(404);
    const empty = await query({ kind: "SEARCH", q: "" });
    expect(empty.status).toBe(400);
  });

  test("limit caps each kind", async () => {
    await seedCorpus();
    const capped = await search({ q: "auth", limit: 1 });
    expect(capped.problems).toHaveLength(1);
  });
});

describe("POST /v1/dispatch — writes", () => {
  test("a view action advances view-state and bumps the revision in the DO", async () => {
    const res = await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { revision: number }).revision).toBe(1);

    const view = (await (await call("/v1/view")).json()) as {
      revision: number;
      stateLabel: string;
      context: { workstreamId: string };
    };
    expect(view.revision).toBe(1);
    expect(view.stateLabel).toContain("workstream_dashboard");
    expect(view.context.workstreamId).toBe("WS-crux");
  });

  test("a mutation is attributed to the token's user", async () => {
    const res = await dispatch({
      kind: "ADD_PROBLEM",
      payload: { workstream: "WS-crux", title: "P", description: "d" },
    });
    expect(((await res.json()) as { result: { ok: boolean } }).result.ok).toBe(true);
    const rows = await db.select().from(problems);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdById).toBe("USR-james");
  });

  test("a refused view event surfaces as an error envelope", async () => {
    const res = await dispatch({ kind: "OPEN_PROBLEM", payload: { id: "999" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()) as { error: { code: string } }).toMatchObject({
      error: { code: expect.any(String) },
    });
  });

  test("concurrent clients cannot both ship the same Solution", async () => {
    // One Problem, one Solution, decided — so exactly one SHIP_SOLUTION is legal
    // and a second must be refused however the two requests interleave.
    const p = (await (
      await dispatch({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-crux", title: "P", description: "d" },
      })
    ).json()) as { result: { id: number } };
    const s = (await (
      await dispatch({ kind: "ADD_SOLUTION", payload: { problem: p.result.id, title: "S" } })
    ).json()) as { result: { id: number } };
    await dispatch({
      kind: "ADD_DECISION",
      payload: { problem: p.result.id, chosen: s.result.id, rationale: "because" },
    });

    const [a, b] = await Promise.all([
      dispatch({ kind: "SHIP_SOLUTION", payload: { id: s.result.id } }),
      dispatch({ kind: "SHIP_SOLUTION", payload: { id: s.result.id } }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
  });
});

describe("Outcome — the door to done", () => {
  /** A Problem filed through the API, the way a client makes one. */
  async function fileProblem(title: string): Promise<number> {
    const res = await dispatch({
      kind: "ADD_PROBLEM",
      payload: { workstream: "WS-crux", title, description: "d" },
    });
    return ((await res.json()) as { result: { id: number } }).result.id;
  }

  async function statusOf(id: number): Promise<string | null> {
    const res = await query({ kind: "PROBLEM_GET", id });
    return ((await res.json()) as { result: { status: string | null } }).result.status;
  }

  test("recording one writes the record and marks the Problem done in one step", async () => {
    const id = await fileProblem("Context evaporates");

    const res = await dispatch({
      kind: "ADD_OUTCOME",
      payload: { problem: id, observedImpact: "sessions start warm", learnings: "structure wins" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { id: string; status: string } };
    expect(body.result.id).toBe("OUT-001");
    expect(body.result.status).toBe("done");

    expect(await statusOf(id)).toBe("done");

    const detail = (await (await query({ kind: "PROBLEM_DETAIL", id })).json()) as {
      result: { outcome: { id: string; observedImpact: string; learnings: string | null } | null };
    };
    expect(detail.result.outcome).toMatchObject({
      id: "OUT-001",
      observedImpact: "sessions start warm",
      learnings: "structure wins",
    });
  });

  test("a Problem carries at most one — the first closes it", async () => {
    const id = await fileProblem("Only once");
    const first = await dispatch({
      kind: "ADD_OUTCOME",
      payload: { problem: id, observedImpact: "a" },
    });
    expect(first.status).toBe(200);

    const second = await dispatch({
      kind: "ADD_OUTCOME",
      payload: { problem: id, observedImpact: "b" },
    });
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({
      error: { code: "ILLEGAL_TRANSITION", message: expect.stringContaining("terminal (done)") },
    });

    const all = (await (await query({ kind: "OUTCOME_LIST" })).json()) as {
      result: Array<{ id: string }>;
    };
    expect(all.result).toHaveLength(1);
  });

  test("a Problem that is already terminal refuses one", async () => {
    const id = await fileProblem("Given up on");
    await dispatch({ kind: "ABANDON_PROBLEM", payload: { id, rationale: "not worth it" } });

    const res = await dispatch({
      kind: "ADD_OUTCOME",
      payload: { problem: id, observedImpact: "too late" },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "ILLEGAL_TRANSITION" } });
    expect(await statusOf(id)).toBe("abandoned");
  });

  test("follow-up Problems link back to it", async () => {
    const id = await fileProblem("Spawns more work");
    const followUp = await fileProblem("The next thing");

    await dispatch({
      kind: "ADD_OUTCOME",
      payload: {
        problem: id,
        observedImpact: "helped, and raised this",
        followUpProblemIds: [followUp],
      },
    });

    const shown = (await (await query({ kind: "OUTCOME_SHOW", id: "OUT-001" })).json()) as {
      result: { problemId: number; followUpProblemIds: number[] };
    };
    expect(shown.result.problemId).toBe(id);
    expect(shown.result.followUpProblemIds).toEqual([followUp]);
    // The follow-up is its own Problem and is untouched by the Outcome.
    expect(await statusOf(followUp)).toBeNull();
  });

  test("a follow-up that is not a Problem in this Workstream is refused, and nothing is written", async () => {
    const id = await fileProblem("Names a stranger");

    const res = await dispatch({
      kind: "ADD_OUTCOME",
      payload: { problem: id, observedImpact: "done", followUpProblemIds: [9999] },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: "REFERENTIAL_MISMATCH" } });

    // The refusal is before the write: no Outcome, and the Problem is still open.
    const all = (await (await query({ kind: "OUTCOME_LIST" })).json()) as { result: unknown[] };
    expect(all.result).toHaveLength(0);
    expect(await statusOf(id)).toBeNull();
  });

  test("there is no other way to mark a Problem done", async () => {
    const id = await fileProblem("Not closable by hand");

    const res = await dispatch({ kind: "MARK_PROBLEM_DONE", payload: { id } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await statusOf(id)).toBeNull();
  });
});

describe("view routes", () => {
  test("GET /v1/view/next answers with the current state and its event list", async () => {
    const body = (await (await call("/v1/view/next")).json()) as {
      value: unknown;
      events: Array<{ type: string; payload: unknown }>;
    };
    expect(body.value).toEqual({ viewing: "workstream_list" });
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("POST /v1/view/reset returns the view to its initial state", async () => {
    await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } });
    const reset = (await (await call("/v1/view/reset", { method: "POST" })).json()) as {
      ok: boolean;
      context: { workstreamId: string | null };
    };
    expect(reset.ok).toBe(true);
    expect(reset.context.workstreamId).toBeNull();

    const view = (await (await call("/v1/view")).json()) as { stateLabel: string };
    expect(view.stateLabel).toContain("workstream_list");
  });

  test("view state is per user — another token sees its own", async () => {
    await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } });
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });
    const otherToken = (await mintToken(db, { userId: "USR-other" })).token;

    const res = await SELF.fetch("https://crux.example/v1/view", {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBe(0);
  });
});

describe("unknown routes", () => {
  test("a /v1 path with no handler is NOT_FOUND", async () => {
    const res = await call("/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  // Paths outside /v1 and /health belong to the browser surfaces now, so an
  // unknown one is answered by the session gate rather than by the API's JSON
  // 404 — an anonymous request never learns whether the path exists.
  test("anything outside /v1 and /health goes to the session gate", async () => {
    const res = await SELF.fetch("https://crux.example/nope", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fnope");
  });
});
