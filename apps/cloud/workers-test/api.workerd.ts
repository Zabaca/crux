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
  // Owned by the token's Principal: since ADR-0013 a Workstream nobody owns is
  // a Workstream nobody can read, so an unowned seed would 404 every read here.
  await db
    .insert(workstreams)
    .values({ id: "WS-crux", slug: "crux", title: "Crux", ownerId: "USR-james" });
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
    await db
      .insert(workstreams)
      .values({ id: "WS-farm", slug: "farm", title: "Farm", ownerId: "USR-james" });
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

  test("concurrent clients cannot both close the same Attempt", async () => {
    // An Attempt closes once, carrying the judgment that made it end that way —
    // so exactly one CLOSE_ATTEMPT is legal however the two requests interleave.
    const p = (await (
      await dispatch({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-crux", title: "P", description: "d" },
      })
    ).json()) as { result: { id: number } };
    const a = (await (
      await dispatch({
        kind: "ADD_ATTEMPT",
        payload: { problem: p.result.id, ref: "ENG-412", label: "spike" },
      })
    ).json()) as { result: { id: string } };

    const close = (closingNote: string) =>
      dispatch({
        kind: "CLOSE_ATTEMPT",
        payload: { id: a.result.id, status: "dropped", closingNote },
      });
    const [first, second] = await Promise.all([close("backpressure"), close("also backpressure")]);

    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);
  });

  test("an Observation is archived once, and the second attempt is refused", async () => {
    const filed = (await (
      await dispatch({
        kind: "ADD_OBSERVATION",
        payload: { workstream: "WS-crux", content: "a signal we will not use" },
      })
    ).json()) as { result: { id: string } };

    const first = await dispatch({
      kind: "ARCHIVE_OBSERVATION",
      payload: { id: filed.result.id, rationale: "duplicate" },
    });
    expect(first.status).toBe(200);

    const second = await dispatch({
      kind: "ARCHIVE_OBSERVATION",
      payload: { id: filed.result.id, rationale: "duplicate again" },
    });
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({
      error: { code: "ILLEGAL_TRANSITION", message: expect.stringContaining("already archived") },
    });

    // Archiving is terminal, not a deletion: the row and its first rationale stay.
    const shown = (await (
      await query({ kind: "OBSERVATION_SHOW", id: filed.result.id })
    ).json()) as { result: { archiveRationale: string } };
    expect(shown.result.archiveRationale).toBe("duplicate");
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

// ---------------------------------------------------------------------------
// Attempts (ADR-0012)
// ---------------------------------------------------------------------------

describe("Attempts", () => {
  /** A Problem to hang Attempts off, filed through the same request path. */
  async function fileProblem(title = "P"): Promise<number> {
    const res = await dispatch({
      kind: "ADD_PROBLEM",
      payload: { workstream: "WS-crux", title, description: "d" },
    });
    return ((await res.json()) as { result: { id: number } }).result.id;
  }

  async function fileAttempt(
    problemId: number,
    ref = "https://tracker.example/T-1",
    label = "Rewrite the ingest path",
  ): Promise<string> {
    const res = await dispatch({
      kind: "ADD_ATTEMPT",
      payload: { problem: problemId, ref, label },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { result: { id: string } }).result.id;
  }

  test("files an Attempt against a Problem with a ref and a label", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);
    expect(id).toBe("ATT-001");

    const listed = (await (await query({ kind: "ATTEMPT_LIST", problem: problemId })).json()) as {
      result: Array<Record<string, unknown>>;
    };

    expect(listed.result).toHaveLength(1);
    expect(listed.result[0]).toMatchObject({
      id: "ATT-001",
      problemId,
      ref: "https://tracker.example/T-1",
      label: "Rewrite the ingest path",
      status: "open",
      closingNote: null,
      createdById: "USR-james",
    });
  });

  test("closes an Attempt as shipped, with the closing note the tracker never keeps", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);

    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "shipped", closingNote: "Landed, but backpressure is still unsolved" },
    });
    expect(res.status).toBe(200);

    const listed = (await (await query({ kind: "ATTEMPT_LIST", problem: problemId })).json()) as {
      result: Array<{ status: string; closingNote: string }>;
    };
    expect(listed.result[0]).toMatchObject({
      status: "shipped",
      closingNote: "Landed, but backpressure is still unsolved",
    });
  });

  test("closes an Attempt as dropped", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);
    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "dropped", closingNote: "The approach could not handle the load" },
    });
    expect(res.status).toBe(200);

    const listed = (await (await query({ kind: "ATTEMPT_LIST", problem: problemId })).json()) as {
      result: Array<{ status: string; closingNote: string }>;
    };
    expect(listed.result[0]).toMatchObject({
      status: "dropped",
      closingNote: "The approach could not handle the load",
    });
  });

  test("concurrent clients cannot both close the same Attempt", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);

    const [a, b] = await Promise.all([
      dispatch({
        kind: "CLOSE_ATTEMPT",
        payload: { id, status: "shipped", closingNote: "landed" },
      }),
      dispatch({
        kind: "CLOSE_ATTEMPT",
        payload: { id, status: "dropped", closingNote: "gave up" },
      }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(400);

    // And the corpus holds exactly one of the two closing notes, not a mix.
    const listed = (await (await query({ kind: "ATTEMPT_LIST", problem: problemId })).json()) as {
      result: Array<{ status: string; closingNote: string }>;
    };
    const row = listed.result[0]!;
    expect([
      { status: "shipped", closingNote: "landed" },
      { status: "dropped", closingNote: "gave up" },
    ]).toContainEqual({ status: row.status, closingNote: row.closingNote });
  });

  test("refuses a status that is neither shipped nor dropped", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);
    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "reopened", closingNote: "n" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  test("refuses an Attempt with no ref and one with no label", async () => {
    const problemId = await fileProblem();
    const noRef = await dispatch({
      kind: "ADD_ATTEMPT",
      payload: { problem: problemId, ref: "  ", label: "L" },
    });
    expect(noRef.status).toBeGreaterThanOrEqual(400);
    expect(await noRef.json()).toMatchObject({ error: { code: "INVARIANT_VIOLATION" } });

    const noLabel = await dispatch({
      kind: "ADD_ATTEMPT",
      payload: { problem: problemId, ref: "https://tracker.example/T-1", label: "" },
    });
    expect(noLabel.status).toBeGreaterThanOrEqual(400);
    expect(await noLabel.json()).toMatchObject({ error: { code: "INVARIANT_VIOLATION" } });
  });

  test("an Attempt against a Problem that does not exist is NOT_FOUND", async () => {
    const res = await dispatch({
      kind: "ADD_ATTEMPT",
      payload: { problem: 9999, ref: "https://tracker.example/T-1", label: "L" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("closing an Attempt that does not exist is NOT_FOUND", async () => {
    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id: "ATT-404", status: "dropped", closingNote: "n" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  test("refuses to close an Attempt without a closing note", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);
    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "dropped", closingNote: "   " },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: { code: "INVARIANT_VIOLATION" } });
  });

  test("refuses a second close — an Attempt closes once", async () => {
    const problemId = await fileProblem();
    const id = await fileAttempt(problemId);
    await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "shipped", closingNote: "done" },
    });
    const res = await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "dropped", closingNote: "no, actually" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: { code: "ILLEGAL_TRANSITION" } });
  });

  test("has nowhere to record a description of the work", async () => {
    const problemId = await fileProblem();
    const res = await dispatch({
      kind: "ADD_ATTEMPT",
      payload: {
        problem: problemId,
        ref: "https://tracker.example/T-2",
        label: "L",
        description: "a copy of the work that would rot",
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const listed = (await (await query({ kind: "ATTEMPT_LIST" })).json()) as {
      result: Array<Record<string, unknown>>;
    };
    expect(listed.result).toHaveLength(0);
  });

  test("a read of an Attempt returns no description field at all", async () => {
    const problemId = await fileProblem();
    await fileAttempt(problemId);
    const listed = (await (await query({ kind: "ATTEMPT_LIST" })).json()) as {
      result: Array<Record<string, unknown>>;
    };
    // The full column set, written out by hand from ADR-0012 rather than read
    // back off the row: problem, ref, label, status, closing note, authorship.
    expect(Object.keys(listed.result[0]!).sort()).toEqual([
      "closingNote",
      "createdAt",
      "createdById",
      "id",
      "label",
      "problemId",
      "ref",
      "status",
      "updatedAt",
    ]);
  });

  test("closing an Attempt as shipped leaves the Problem's stage untouched", async () => {
    const problemId = await fileProblem();
    await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } });
    const id = await fileAttempt(problemId);

    await dispatch({
      kind: "CLOSE_ATTEMPT",
      payload: { id, status: "shipped", closingNote: "shipped it" },
    });

    const shown = (await (await query({ kind: "PROBLEM_SHOW", id: problemId })).json()) as {
      result: { status: string | null };
    };
    // Still `now`, not `done`: something shipping is a fact about the world;
    // the Problem being gone is a judgment somebody makes (ADR-0012).
    expect(shown.result.status).toBe("now");
  });

  test("Attempts hang off the Problem in PROBLEM_DETAIL and the context digest", async () => {
    const problemId = await fileProblem();
    await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } });
    await fileAttempt(problemId, "https://tracker.example/T-7", "Batch the writes");

    const detail = (await (await query({ kind: "PROBLEM_DETAIL", id: problemId })).json()) as {
      result: { attempts: Array<{ id: string; label: string; ref: string }> };
    };
    expect(detail.result.attempts).toHaveLength(1);
    expect(detail.result.attempts[0]).toMatchObject({
      id: "ATT-001",
      label: "Batch the writes",
      ref: "https://tracker.example/T-7",
    });

    const digest = (await (
      await query({ kind: "CONTEXT", workstream: "crux", stages: ["now"] })
    ).json()) as { result: { now: Array<{ attempts: Array<{ id: string }> }> } };
    expect(digest.result.now[0]!.attempts.map((a) => a.id)).toEqual(["ATT-001"]);
  });

  describe("the drift query", () => {
    test("names a staged Problem with no open Attempt, and omits one with", async () => {
      const drifting = await fileProblem("Drifting");
      const worked = await fileProblem("Worked on");
      await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: drifting, stage: "now" } });
      await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: worked, stage: "now" } });
      await fileAttempt(worked);

      const res = (await (await query({ kind: "PROBLEM_DRIFT", workstream: "crux" })).json()) as {
        result: Array<{ id: number; title: string; attemptCount: number }>;
      };
      expect(res.result.map((p) => p.title)).toEqual(["Drifting"]);
      expect(res.result[0]!.attemptCount).toBe(0);
    });

    test("a Problem whose only Attempt is closed has drifted again", async () => {
      const problemId = await fileProblem("Was worked on");
      await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } });
      const id = await fileAttempt(problemId);
      await dispatch({
        kind: "CLOSE_ATTEMPT",
        payload: { id, status: "dropped", closingNote: "could not handle the load" },
      });

      const res = (await (await query({ kind: "PROBLEM_DRIFT", workstream: "crux" })).json()) as {
        result: Array<{ title: string; attemptCount: number }>;
      };
      expect(res.result.map((p) => p.title)).toEqual(["Was worked on"]);
      // One Attempt, and it is closed: worked on and stopped, which reads
      // differently from a Problem nobody ever touched.
      expect(res.result[0]!.attemptCount).toBe(1);
    });

    test("only the stages asked for count as active — `now` by default", async () => {
      const later = await fileProblem("Later, untouched");
      const unscheduled = await fileProblem("Never scheduled");
      await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: later, stage: "later" } });

      const byDefault = (await (
        await query({ kind: "PROBLEM_DRIFT", workstream: "crux" })
      ).json()) as { result: Array<{ title: string }> };
      expect(byDefault.result).toEqual([]);

      const widened = (await (
        await query({ kind: "PROBLEM_DRIFT", workstream: "crux", stages: ["now", "later"] })
      ).json()) as { result: Array<{ id: number; title: string }> };
      expect(widened.result.map((p) => p.title)).toEqual(["Later, untouched"]);
      expect(widened.result.map((p) => p.id)).not.toContain(unscheduled);
    });

    test("a terminal stage is not a stage anything can drift in", async () => {
      const res = await query({ kind: "PROBLEM_DRIFT", workstream: "crux", stages: ["done"] });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    });
  });
});

// ---------------------------------------------------------------------------
// Anonymous Principals
// ---------------------------------------------------------------------------

/** Mint a Principal the way a machine with no configuration does. */
async function mintPrincipal(body: unknown = {}): Promise<{
  token: string;
  principal: { id: string; name: string };
  status: number;
}> {
  const res = await SELF.fetch("https://crux.example/v1/principals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as { token: string; principal: { id: string; name: string } };
  return { ...parsed, status: res.status };
}

/** Any request, as a given bearer token — the CLI's exact shape. */
function as(bearer: string, path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://crux.example${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${bearer}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const queryAs = (bearer: string, q: unknown) =>
  as(bearer, "/v1/query", { method: "POST", body: JSON.stringify(q) });
const dispatchAs = (bearer: string, action: unknown) =>
  as(bearer, "/v1/dispatch", { method: "POST", body: JSON.stringify(action) });

describe("POST /v1/principals — first use", () => {
  test("an unauthenticated client mints a Principal and can immediately write", async () => {
    const minted = await mintPrincipal();
    expect(minted.status).toBe(201);
    expect(minted.token).toMatch(/^crux_/);
    expect(minted.principal.name).toBe("Anonymous");

    // No invite, no email, no operator: the token is the whole of the identity.
    const ws = await dispatchAs(minted.token, {
      kind: "ADD_WORKSTREAM",
      payload: { slug: "fresh", title: "Fresh" },
    });
    expect(ws.status).toBe(200);

    const obs = await dispatchAs(minted.token, {
      kind: "ADD_OBSERVATION",
      payload: { workstream: "fresh", content: "filed without signing up for anything" },
    });
    expect(obs.status).toBe(200);

    const read = (await (
      await queryAs(minted.token, { kind: "OBSERVATION_LIST", workstream: "fresh" })
    ).json()) as { result: Array<{ content: string; reporterId: string }> };
    expect(read.result.map((o) => o.content)).toEqual(["filed without signing up for anything"]);
    // Authorship still resolves to an actor — the Principal that filed it.
    expect(read.result[0]!.reporterId).toBe(minted.principal.id);
  });

  test("two mints are two Principals, not one shared one", async () => {
    const a = await mintPrincipal();
    const b = await mintPrincipal();
    expect(a.principal.id).not.toBe(b.principal.id);
    expect(a.token).not.toBe(b.token);
  });

  test("the mint takes no fields — a Principal is a token, not a person", async () => {
    // An unauthenticated endpoint that accepted a name would be the one place
    // an anonymous caller could write free text into the database, for nothing
    // ADR-0013 asks for. A human name arrives with a claim.
    const named = await mintPrincipal({ name: "Dana's laptop" });
    expect(named.principal.name).toBe("Anonymous");
  });
});

describe("tenancy over HTTP — the boundary is the credential", () => {
  /** A Principal with a Workstream, a Problem and an Observation of its own. */
  async function tenant(slug: string) {
    const { token, principal } = await mintPrincipal();
    await dispatchAs(token, {
      kind: "ADD_WORKSTREAM",
      payload: { slug, title: `${slug} title` },
    });
    const problem = (await (
      await dispatchAs(token, {
        kind: "ADD_PROBLEM",
        payload: { workstream: slug, title: `${slug} private`, description: `${slug} private` },
      })
    ).json()) as { result: { id: number } };
    const observation = (await (
      await dispatchAs(token, {
        kind: "ADD_OBSERVATION",
        payload: { workstream: slug, content: `${slug} private signal` },
      })
    ).json()) as { result: { id: string } };
    return { token, principal, slug, problemId: problem.result.id, obsId: observation.result.id };
  }

  test("one Principal's corpus is invisible to another's token", async () => {
    const a = await tenant("alpha");
    const b = await tenant("bravo");

    // The scope comes from the bearer token the server resolved, not from
    // anything either request said about itself.
    const list = (await (await queryAs(b.token, { kind: "WORKSTREAM_LIST" })).json()) as {
      result: Array<{ slug: string }>;
    };
    expect(list.result.map((w) => w.slug)).toEqual(["bravo"]);

    // Named directly, A's rows are *missing*, not forbidden.
    expect((await queryAs(b.token, { kind: "PROBLEM_SHOW", id: a.problemId })).status).toBe(404);
    expect((await queryAs(b.token, { kind: "OBSERVATION_SHOW", id: a.obsId })).status).toBe(404);
    expect(
      (await queryAs(b.token, { kind: "CONTEXT", workstream: "alpha", stages: ["now"] })).status,
    ).toBe(404);

    const search = (await (await queryAs(b.token, { kind: "SEARCH", q: "private" })).json()) as {
      result: { problems: unknown[]; observations: unknown[] };
    };
    expect(JSON.stringify(search.result)).not.toContain("alpha");

    // And A still sees all of its own.
    const mine = (await (await queryAs(a.token, { kind: "WORKSTREAM_LIST" })).json()) as {
      result: Array<{ slug: string }>;
    };
    expect(mine.result.map((w) => w.slug)).toEqual(["alpha"]);
  });

  test("a write cannot reach across the boundary either", async () => {
    const a = await tenant("alpha");
    const b = await tenant("bravo");

    // Linking A's Observation to B's Problem would put A's words inside B's
    // corpus, where every later read would disclose them while doing its job.
    const evidence = await dispatchAs(b.token, {
      kind: "ADD_EVIDENCE",
      payload: { problem: b.problemId, observation: a.obsId, note: "borrowed" },
    });
    expect(evidence.status).toBe(404);

    const schedule = await dispatchAs(b.token, {
      kind: "SCHEDULE_PROBLEM",
      payload: { id: a.problemId, stage: "now" },
    });
    expect(schedule.status).toBe(404);

    const archive = await dispatchAs(b.token, {
      kind: "ARCHIVE_OBSERVATION",
      payload: { id: a.obsId, rationale: "not mine to archive" },
    });
    expect(archive.status).toBe(404);

    // Nothing was written by any of the three.
    const detail = (await (
      await queryAs(a.token, { kind: "PROBLEM_DETAIL", id: a.problemId })
    ).json()) as { result: { problem: { status: string | null }; evidence: unknown[] } };
    expect(detail.result.problem.status).toBeNull();
    expect(detail.result.evidence).toEqual([]);
  });

  test("a previously minted token keeps working, and keeps its own corpus", async () => {
    const fresh = await tenant("bravo");
    // `token` is the invited Member's, minted in beforeEach — the CLI door that
    // existed before Principals did.
    const mine = (await (await query({ kind: "WORKSTREAM_LIST" })).json()) as {
      result: Array<{ slug: string }>;
    };
    expect(mine.result.map((w) => w.slug)).toEqual(["crux"]);
    expect((await queryAs(fresh.token, { kind: "WORKSTREAM_SHOW", id: "WS-crux" })).status).toBe(
      404,
    );
  });
});

describe("the boundary is not an oracle", () => {
  test("a follow-up in another Principal's Workstream reads as one that does not exist", async () => {
    // Two tenants, each with a Problem. The refusal must not tell B that A's
    // Problem exists, and must not name the Workstream it belongs to.
    const stranger = await mintPrincipal();
    await dispatchAs(stranger.token, {
      kind: "ADD_WORKSTREAM",
      payload: { slug: "stranger", title: "Stranger" },
    });
    const theirs = (await (
      await dispatchAs(stranger.token, {
        kind: "ADD_PROBLEM",
        payload: { workstream: "stranger", title: "Theirs", description: "d" },
      })
    ).json()) as { result: { id: number } };

    const mine = (await (
      await dispatch({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-crux", title: "Mine", description: "d" },
      })
    ).json()) as { result: { id: number } };

    const res = await dispatch({
      kind: "ADD_OUTCOME",
      payload: {
        problem: mine.result.id,
        observedImpact: "done",
        followUpProblemIds: [theirs.result.id],
      },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("REFERENTIAL_MISMATCH");
    // The words a *missing* follow-up gets — no Workstream id of theirs in it.
    expect(body.error.message).toBe(`Problem not found: ${theirs.result.id}`);
    expect(body.error.message).not.toContain("WS-stranger");
  });

  test("selecting another Principal's Workstream is refused like one that never existed", async () => {
    const stranger = await mintPrincipal();
    await dispatchAs(stranger.token, {
      kind: "ADD_WORKSTREAM",
      payload: { slug: "stranger", title: "Stranger" },
    });

    // A view guard that looked at the whole database would let this through,
    // while refusing a slug nobody has — an existence oracle without a row leak.
    const refusal = async (id: string) => {
      const res = await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id } });
      const body = (await res.json()) as { error: { code: string; message: string } };
      // The id is the caller's own input, so echoing it back tells them nothing.
      return { status: res.status, ...body.error, message: body.error.message.replace(id, "<id>") };
    };
    expect(await refusal("WS-stranger")).toEqual(await refusal("WS-nobody"));

    // And selecting my own still works.
    expect((await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } })).status).toBe(
      200,
    );
  });

  test("a slug another Principal already took is refused in words, not with a 500", async () => {
    const other = await mintPrincipal();
    const res = await dispatchAs(other.token, {
      kind: "ADD_WORKSTREAM",
      payload: { slug: "crux", title: "Also called crux" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ALREADY_EXISTS");
    expect(body.error.message).toContain("taken on this deployment");
  });
});

describe("change events name the Workstream they came from", () => {
  /**
   * Open the push stream, run `act`, and return the first `view` frame it
   * pushes. The subscriber is registered by the time the response resolves, so
   * the action that follows is the one this frame reports.
   */
  async function frameFor(act: () => Promise<unknown>): Promise<{
    revision: number;
    workstreamId: string | null;
  }> {
    const stream = await call("/v1/view/stream");
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    await act();
    let buffered = "";
    // The stream opens with a `: connected` comment; the frame we want is the
    // next one. Bounded so a stream that never carries it fails rather than hangs.
    for (let i = 0; i < 5; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const match = buffered.match(/event: view\ndata: (.*)\n\n/);
      if (match) {
        await reader.cancel();
        return JSON.parse(match[1]!) as { revision: number; workstreamId: string | null };
      }
    }
    await reader.cancel();
    throw new Error(`no view frame in stream: ${JSON.stringify(buffered)}`);
  }

  const lastAction = async () =>
    (
      (await (await call("/v1/view")).json()) as {
        lastAction: { kind: string; ts: number; workstreamId: string | null };
      }
    ).lastAction;

  test("a mutation's lastAction names the Workstream whose data moved", async () => {
    await dispatch({
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "the token expired mid-demo" },
    });
    expect(await lastAction()).toMatchObject({
      kind: "ADD_OBSERVATION",
      workstreamId: "WS-crux",
    });
  });

  test("a mutation in another Workstream names that one instead", async () => {
    await db
      .insert(workstreams)
      .values({ id: "WS-farm", slug: "farm", title: "Farm", ownerId: "USR-james" });
    const filed = (await (
      await dispatch({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-farm", title: "P", description: "d" },
      })
    ).json()) as { result: { id: number } };
    expect(await lastAction()).toMatchObject({ workstreamId: "WS-farm" });

    // And a transition reached through the Problem, not the Workstream, still
    // resolves back to it — the row the scope check already read names it.
    await dispatch({ kind: "SCHEDULE_PROBLEM", payload: { id: filed.result.id, stage: "now" } });
    expect(await lastAction()).toMatchObject({
      kind: "SCHEDULE_PROBLEM",
      workstreamId: "WS-farm",
    });
  });

  test("an action that touches no Workstream is still well-formed", async () => {
    await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } });
    expect(await lastAction()).toMatchObject({ workstreamId: "WS-crux" });

    // BACK to the Workstream list points at nothing, and says so.
    await dispatch({ kind: "BACK" });
    expect(await lastAction()).toEqual({
      kind: "BACK",
      ts: expect.any(Number),
      workstreamId: null,
    });
  });

  test("the push frame carries the Workstream beside the revision", async () => {
    const frame = await frameFor(() =>
      dispatch({
        kind: "ADD_OBSERVATION",
        payload: { workstream: "WS-crux", content: "filed from a terminal" },
      }),
    );
    expect(frame).toEqual({ revision: 1, workstreamId: "WS-crux" });
  });

  test("a frame from an action touching no Workstream carries null", async () => {
    await dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } });
    const frame = await frameFor(() => dispatch({ kind: "BACK" }));
    expect(frame.workstreamId).toBeNull();
    expect(frame.revision).toBeGreaterThan(0);
  });
});
