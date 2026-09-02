/**
 * The CLI is a thin client (ADR-0003): it owns argument parsing, the request it
 * sends, and how a response — or an error envelope — reaches the terminal. It
 * owns no corpus logic at all, so these tests drive commands through their
 * `run()` against a stub transport and assert exactly that: the request issued,
 * the payload emitted unchanged, and the error class rebuilt from the wire.
 *
 * The shapes those requests produce are tested where they are produced, against
 * a real D1 — `packages/core/workers-test/reads.workerd.ts`.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiClient, setApiClient, ApiError } from "../api-client.js";
import { setCaptureWriter, setJsonMode } from "../output.js";
import { EXIT_CODES } from "../errors.js";
import { CruxError } from "@crux/core/transitions";
import { ActionNotAllowedError } from "@crux/core/actions";

import { workstreamCommand } from "../commands/workstream.js";
import { problemCommand } from "../commands/problem.js";
import { observationCommand } from "../commands/observation.js";
import { contextCommand } from "../commands/context.js";
import { attemptCommand } from "../commands/attempt.js";
import { viewCommand } from "../commands/view.js";
import { searchCommand } from "../commands/search.js";
import { outcomeCommand } from "../commands/outcome.js";

type AnyCmd = {
  run?: (ctx: { args: Record<string, unknown>; rawArgs?: string[] }) => Promise<void>;
  subCommands?: Record<string, AnyCmd>;
};

async function runCmd(parent: AnyCmd, sub: string, args: Record<string, unknown>): Promise<void> {
  const cmd = sub === "run" ? parent : parent.subCommands![sub]!;
  await cmd.run!({ args, rawArgs: [] });
}

async function capture<T>(fn: () => Promise<void>): Promise<T> {
  let result: unknown;
  setCaptureWriter((payload) => {
    result = payload;
  });
  try {
    await fn();
  } finally {
    setCaptureWriter(null);
  }
  return result as T;
}

/** One recorded HTTP call. */
type Call = { url: string; method: string; body: unknown; auth: string | undefined };

/** A stub deployment: `routes` maps "<METHOD> <path>" to a response body. */
function stubServer(routes: Record<string, unknown | (() => Response)>) {
  const calls: Call[] = [];
  const transport = async (url: string, init: RequestInit): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    const headers = init.headers as Record<string, string>;
    calls.push({
      url,
      method,
      body: init.body ? JSON.parse(init.body as string) : undefined,
      auth: headers?.authorization,
    });
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) return new Response("{}", { status: 404 });
    if (typeof handler === "function") return (handler as () => Response)();
    return new Response(JSON.stringify(handler), { status: 200 });
  };
  setApiClient(createApiClient({ baseUrl: "https://crux.test/", token: "tok-1", transport }));
  return calls;
}

/** The error envelope the Worker sends for a given code. */
function envelope(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): () => Response {
  return () =>
    new Response(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }), {
      status,
    });
}

/** The smallest digest `ContextOutput` accepts — the stub's stand-in corpus. */
const DIGEST = {
  workstream: { id: "WS-smoke", slug: "smoke", title: "Smoke WS" },
  seed_version: "2026-04-21",
  now: [],
};

/** A `/v1/view` body with a workstream selected — what `wsArg()` needs. */
const VIEW_WITH_WS = {
  value: { viewing: "workstream_dashboard" },
  context: { workstreamId: "WS-smoke", problemId: null },
  revision: 3,
  lastAction: { kind: "SELECT_WORKSTREAM", ts: 1 },
  allowedActions: ["OPEN_PROBLEM"],
  globalActions: ["ADD_OBSERVATION"],
};

beforeEach(() => {
  setJsonMode(false);
  setCaptureWriter(null);
});

afterEach(() => {
  setApiClient(null);
  setJsonMode(false);
  setCaptureWriter(null);
});

// ---------------------------------------------------------------------------
// Reads go out as named queries; the payload is emitted unchanged
// ---------------------------------------------------------------------------

describe("reads", () => {
  test("workstream list asks for WORKSTREAM_LIST and prints what came back", async () => {
    const rows = [{ id: "WS-smoke", slug: "smoke", title: "Smoke WS" }];
    const calls = stubServer({ "POST /v1/query": { result: rows } });

    const out = await capture(() => runCmd(workstreamCommand as AnyCmd, "list", { json: true }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://crux.test/v1/query");
    expect(calls[0]!.auth).toBe("Bearer tok-1");
    expect(calls[0]!.body).toEqual({ kind: "WORKSTREAM_LIST" });
    expect(out).toEqual(rows);
  });

  test("search goes out unscoped, and does not touch view state", async () => {
    const results = { query: "auth", problems: [], observations: [] };
    const calls = stubServer({ "POST /v1/query": { result: results } });

    const out = await capture(() =>
      runCmd(searchCommand as AnyCmd, "run", { query: "auth", json: true }),
    );

    expect(calls.map((c) => c.url)).toEqual(["https://crux.test/v1/query"]);
    expect(calls[0]!.body).toEqual({
      kind: "SEARCH",
      q: "auth",
      workstream: undefined,
      limit: undefined,
    });
    expect(out).toEqual(results);
  });

  test("search passes --workstream and --limit through", async () => {
    const calls = stubServer({
      "POST /v1/query": { result: { query: "auth", problems: [], observations: [] } },
    });

    await capture(() =>
      runCmd(searchCommand as AnyCmd, "run", {
        query: "auth",
        workstream: "crux",
        limit: "5",
        json: true,
      }),
    );

    expect(calls[0]!.body).toEqual({ kind: "SEARCH", q: "auth", workstream: "crux", limit: 5 });
  });

  test("a non-numeric --limit is refused as VALIDATION_ERROR, before a request goes out", async () => {
    const calls = stubServer({ "POST /v1/query": { result: {} } });

    const err = await runCmd(searchCommand as AnyCmd, "run", { query: "auth", limit: "lots" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CruxError);
    expect((err as CruxError).code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  test("problem list carries the selected workstream and the status filter", async () => {
    const calls = stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/query": { result: [] },
    });

    await capture(() => runCmd(problemCommand as AnyCmd, "list", { status: "now", json: true }));

    expect(calls.map((c) => c.body).at(-1)).toEqual({
      kind: "PROBLEM_LIST",
      workstream: "WS-smoke",
      status: "now",
    });
  });

  test("context defaults to the `now` bucket and --all opens every one", async () => {
    const calls = stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/query": { result: DIGEST },
    });

    await capture(() => runCmd(contextCommand as AnyCmd, "run", { json: true }));
    expect(calls.at(-1)!.body).toEqual({
      kind: "CONTEXT",
      workstream: "WS-smoke",
      stages: ["now"],
      includeExtras: false,
      showArchived: false,
    });

    await capture(() =>
      runCmd(contextCommand as AnyCmd, "run", { all: true, "show-archived": true, json: true }),
    );
    expect(calls.at(-1)!.body).toEqual({
      kind: "CONTEXT",
      workstream: "WS-smoke",
      stages: ["now", "next", "later", "unscheduled", "done", "abandoned"],
      includeExtras: true,
      showArchived: true,
    });
  });

  test("context --stage passes exactly the buckets asked for", async () => {
    const calls = stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/query": { result: DIGEST },
    });
    await capture(() =>
      runCmd(contextCommand as AnyCmd, "run", { stage: "now, done", json: true }),
    );
    expect((calls.at(-1)!.body as { stages: string[] }).stages).toEqual(["now", "done"]);
  });

  test("problem show emits the digest the server sent, untouched", async () => {
    const shown = {
      id: 7,
      workstreamId: "WS-smoke",
      title: "P",
      description: "D",
      status: null,
      createdById: "USR-test",
      createdAt: 1,
      updatedAt: 1,
      attempts: [],
      outcome: null,
    };
    stubServer({ "POST /v1/query": { result: shown } });
    const out = await capture(() =>
      runCmd(problemCommand as AnyCmd, "show", { id: "7", json: true }),
    );
    expect(out).toEqual(shown);
  });
});

// ---------------------------------------------------------------------------
// Writes go out as actions
// ---------------------------------------------------------------------------

describe("writes", () => {
  test("workstream add dispatches ADD_WORKSTREAM and emits the result", async () => {
    const calls = stubServer({
      "POST /v1/dispatch": { revision: 1, result: { ok: true, id: "WS-smoke" } },
    });

    const out = await capture(() =>
      runCmd(workstreamCommand as AnyCmd, "add", { slug: "smoke", title: "Smoke WS", json: true }),
    );

    expect(calls[0]!.url).toBe("https://crux.test/v1/dispatch");
    expect(calls[0]!.body).toEqual({
      kind: "ADD_WORKSTREAM",
      payload: { slug: "smoke", title: "Smoke WS", description: undefined },
    });
    expect(out).toEqual({ ok: true, id: "WS-smoke" });
  });

  test("attempt add dispatches ADD_ATTEMPT with only a ref and a label", async () => {
    const calls = stubServer({
      "POST /v1/dispatch": { revision: 1, result: { ok: true, id: "ATT-001" } },
    });

    const out = await capture(() =>
      runCmd(attemptCommand as AnyCmd, "add", {
        problem: "7",
        ref: "https://tracker.example/ENG-412",
        label: "Reload the digest as structure",
        json: true,
      }),
    );

    expect(calls[0]!.body).toEqual({
      kind: "ADD_ATTEMPT",
      payload: {
        problem: "7",
        ref: "https://tracker.example/ENG-412",
        label: "Reload the digest as structure",
      },
    });
    expect(out).toEqual({ ok: true, id: "ATT-001" });
  });

  test("attempt close dispatches CLOSE_ATTEMPT with the closing note", async () => {
    const calls = stubServer({
      "POST /v1/dispatch": { revision: 2, result: { ok: true, id: "ATT-001", status: "dropped" } },
    });

    await capture(() =>
      runCmd(attemptCommand as AnyCmd, "close", {
        id: "ATT-001",
        status: "dropped",
        note: "The approach could not handle backpressure",
        json: true,
      }),
    );

    expect(calls[0]!.body).toEqual({
      kind: "CLOSE_ATTEMPT",
      payload: {
        id: "ATT-001",
        status: "dropped",
        closingNote: "The approach could not handle backpressure",
      },
    });
  });

  test("attempt drift asks for PROBLEM_DRIFT in the selected workstream", async () => {
    const calls = stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/query": { result: [] },
    });

    await capture(() => runCmd(attemptCommand as AnyCmd, "drift", { json: true }));

    expect(calls.at(-1)!.body).toEqual({ kind: "PROBLEM_DRIFT", workstream: "WS-smoke" });
  });

  test("observation add splits comma-separated tags and uses the selected workstream", async () => {
    const calls = stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/dispatch": { revision: 2, result: { ok: true, id: "OBS-1" } },
    });

    await capture(() =>
      runCmd(observationCommand as AnyCmd, "add", {
        content: "Something observed",
        tag: "alpha, beta",
        json: true,
      }),
    );

    expect(calls.at(-1)!.body).toMatchObject({
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-smoke", content: "Something observed", tags: ["alpha", "beta"] },
    });
  });

  test("outcome add names the Problem it closes, and splits its follow-ups", async () => {
    const calls = stubServer({
      "POST /v1/dispatch": { revision: 3, result: { ok: true, id: "OUT-001", status: "done" } },
    });

    const out = await capture(() =>
      runCmd(outcomeCommand as AnyCmd, "add", {
        problem: "7",
        "observed-impact": "sessions start warm",
        learnings: "structure wins",
        "follow-up-problems": "8, 9",
        json: true,
      }),
    );

    expect(calls[0]!.body).toEqual({
      kind: "ADD_OUTCOME",
      payload: {
        problem: "7",
        observedImpact: "sessions start warm",
        learnings: "structure wins",
        followUpProblemIds: ["8", "9"],
      },
    });
    expect(out).toEqual({ ok: true, id: "OUT-001", status: "done" });
  });
});

// ---------------------------------------------------------------------------
// The error envelope round-trip
// ---------------------------------------------------------------------------

describe("server rejections reach the terminal unchanged", () => {
  test("a NOT_FOUND envelope becomes a CruxError with exit code 23", async () => {
    stubServer({ "POST /v1/query": envelope(404, "NOT_FOUND", "problem not found: 9") });

    const err = await runCmd(problemCommand as AnyCmd, "show", { id: "9", json: true }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(CruxError);
    expect((err as CruxError).code).toBe("NOT_FOUND");
    expect((err as CruxError).message).toBe("problem not found: 9");
    expect(EXIT_CODES[(err as CruxError).code]).toBe(23);
  });

  test("an ILLEGAL_TRANSITION rejection keeps its code, message and details", async () => {
    stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/dispatch": envelope(
        422,
        "ILLEGAL_TRANSITION",
        "cannot close an Attempt that is already closed",
        { attemptId: "ATT-001", status: "dropped" },
      ),
    });

    const err = (await runCmd(attemptCommand as AnyCmd, "close", {
      id: "ATT-001",
      status: "shipped",
      note: "n",
      json: true,
    }).catch((e) => e)) as CruxError;

    expect(err).toBeInstanceOf(CruxError);
    expect(err.code).toBe("ILLEGAL_TRANSITION");
    expect(err.details).toEqual({ attemptId: "ATT-001", status: "dropped" });
    expect(EXIT_CODES[err.code]).toBe(20);
  });

  test("an ACTION_NOT_ALLOWED rejection is rebuilt with its allowed lists", async () => {
    stubServer({
      "POST /v1/dispatch": envelope(409, "ACTION_NOT_ALLOWED", "not allowed", {
        state: { viewing: "workstream_list" },
        attempted: "ADD_WORKSTREAM",
        allowedView: ["SELECT_WORKSTREAM"],
        allowedMutation: [],
        globals: ["ADD_OBSERVATION"],
      }),
    });

    const err = (await runCmd(workstreamCommand as AnyCmd, "add", {
      slug: "x",
      title: "X",
      json: true,
    }).catch((e) => e)) as ActionNotAllowedError;

    expect(err).toBeInstanceOf(ActionNotAllowedError);
    expect(err.attempted).toBe("ADD_WORKSTREAM");
    expect(err.allowedView).toEqual(["SELECT_WORKSTREAM"]);
    expect(err.globals).toEqual(["ADD_OBSERVATION"]);
    expect(EXIT_CODES[err.code]).toBe(25);
  });

  test("an unusable token is reported as UNAUTHENTICATED, not as a corpus error", async () => {
    stubServer({
      "POST /v1/query": envelope(401, "UNAUTHENTICATED", "missing or invalid bearer token"),
    });

    const err = (await runCmd(workstreamCommand as AnyCmd, "list", { json: true }).catch(
      (e) => e,
    )) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(EXIT_CODES[err.code]).toBe(26);
  });

  test("an unreachable deployment names the deployment it could not reach", async () => {
    setApiClient(
      createApiClient({
        baseUrl: "https://crux.test",
        token: "tok-1",
        transport: () => Promise.reject(new Error("ECONNREFUSED")),
      }),
    );

    const err = (await runCmd(workstreamCommand as AnyCmd, "list", { json: true }).catch(
      (e) => e,
    )) as ApiError;

    expect(err.code).toBe("API_UNREACHABLE");
    expect(err.message).toContain("https://crux.test");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("api configuration", () => {
  /**
   * First use, with nothing configured at all.
   *
   * Adoption is anonymous-first (ADR-0013): there is no registration, so the
   * absence of a token is not a setup error to report — it is the request that
   * mints one. `global.fetch` is stubbed rather than the client, because the
   * whole point of this test is the path `api()` takes when nothing has pinned
   * a client for it.
   */
  test("an unconfigured machine mints a Principal, persists it, and files the write", async () => {
    setApiClient(null);
    const home = mkdtempSync(join(tmpdir(), "crux-first-use-"));
    const prev = {
      url: process.env.CRUX_API_URL,
      token: process.env.CRUX_API_TOKEN,
      home: process.env.CRUX_HOME,
      fetch: globalThis.fetch,
    };
    delete process.env.CRUX_API_TOKEN;
    process.env.CRUX_API_URL = "https://crux.test";
    process.env.CRUX_HOME = home;

    const seen: Array<{ path: string; auth: string | undefined }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      seen.push({ path, auth });
      if (path === "/v1/principals") {
        return new Response(
          JSON.stringify({ principal: { id: "USR-anon", name: "Anonymous" }, token: "tok-minted" }),
          { status: 201 },
        );
      }
      if (path === "/v1/view") return new Response(JSON.stringify(VIEW_WITH_WS));
      return new Response(JSON.stringify({ revision: 1, result: { ok: true, id: "OBS-001" } }));
    }) as unknown as typeof fetch;

    try {
      const out = await capture(() =>
        runCmd(observationCommand as AnyCmd, "add", {
          content: "the corpus is unreachable from a fresh machine",
          json: true,
        }),
      );
      expect(out).toEqual({ ok: true, id: "OBS-001" });
      // Minted once, before anything else, and every later call bears it.
      expect(seen.map((c) => c.path)).toEqual(["/v1/principals", "/v1/view", "/v1/dispatch"]);
      expect(seen.slice(1).map((c) => c.auth)).toEqual(["Bearer tok-minted", "Bearer tok-minted"]);
      // Persisted, so the next command reuses the Principal rather than
      // stranding this Observation on a token nobody kept.
      expect(readFileSync(join(home, "config.toml"), "utf8")).toContain("tok-minted");
    } finally {
      globalThis.fetch = prev.fetch;
      if (prev.url) process.env.CRUX_API_URL = prev.url;
      else delete process.env.CRUX_API_URL;
      if (prev.token) process.env.CRUX_API_TOKEN = prev.token;
      if (prev.home) process.env.CRUX_HOME = prev.home;
      else delete process.env.CRUX_HOME;
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a configured token is used as-is — no Principal is minted", async () => {
    setApiClient(null);
    const prev = {
      url: process.env.CRUX_API_URL,
      token: process.env.CRUX_API_TOKEN,
      home: process.env.CRUX_HOME,
      fetch: globalThis.fetch,
    };
    process.env.CRUX_API_URL = "https://crux.test";
    process.env.CRUX_API_TOKEN = "tok-configured";
    process.env.CRUX_HOME = "/nonexistent-crux-home";

    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen.push(new URL(String(url)).pathname);
      return new Response(JSON.stringify({ result: [] }));
    }) as unknown as typeof fetch;

    try {
      await capture(() => runCmd(workstreamCommand as AnyCmd, "list", { json: true }));
      expect(seen).toEqual(["/v1/query"]);
    } finally {
      globalThis.fetch = prev.fetch;
      if (prev.url) process.env.CRUX_API_URL = prev.url;
      else delete process.env.CRUX_API_URL;
      if (prev.token) process.env.CRUX_API_TOKEN = prev.token;
      else delete process.env.CRUX_API_TOKEN;
      if (prev.home) process.env.CRUX_HOME = prev.home;
      else delete process.env.CRUX_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// View state lives in the deployment
// ---------------------------------------------------------------------------

describe("view", () => {
  test("view get reports the deployment's state without inventing fields", async () => {
    stubServer({ "GET /v1/view": { ...VIEW_WITH_WS, stateLabel: "viewing.workstream_dashboard" } });
    const out = await capture(() => runCmd(viewCommand as AnyCmd, "get", { json: true }));
    expect(out).toEqual(VIEW_WITH_WS);
  });

  test("view path points at the endpoint that serves view state", async () => {
    stubServer({});
    const out = await capture(() => runCmd(viewCommand as AnyCmd, "path", { json: true }));
    expect(out).toEqual({ path: "https://crux.test/v1/view" });
  });

  test("view reset posts to the deployment", async () => {
    const calls = stubServer({
      "POST /v1/view/reset": {
        ok: true,
        value: { viewing: "workstream_list" },
        context: { workstreamId: null, problemId: null },
      },
    });
    await capture(() => runCmd(viewCommand as AnyCmd, "reset", { json: true }));
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://crux.test/v1/view/reset");
  });
});
