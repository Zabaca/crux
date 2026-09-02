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

import { createApiClient, setApiClient, ApiError } from "../api-client.js";
import { setCaptureWriter, setJsonMode } from "../output.js";
import { EXIT_CODES } from "../errors.js";
import { CruxError } from "@crux/core/transitions";
import { ActionNotAllowedError } from "@crux/core/actions";

import { workstreamCommand } from "../commands/workstream.js";
import { problemCommand } from "../commands/problem.js";
import { observationCommand } from "../commands/observation.js";
import { contextCommand } from "../commands/context.js";
import { solutionCommand } from "../commands/solution.js";
import { viewCommand } from "../commands/view.js";
import { searchCommand } from "../commands/search.js";

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
      runCmd(searchCommand as AnyCmd, "run", { terms: "auth", json: true }),
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
        terms: "auth",
        workstream: "crux",
        limit: "5",
        json: true,
      }),
    );

    expect(calls[0]!.body).toEqual({ kind: "SEARCH", q: "auth", workstream: "crux", limit: 5 });
  });

  test("a non-numeric --limit is refused before a request goes out", async () => {
    const calls = stubServer({ "POST /v1/query": { result: {} } });

    await expect(
      runCmd(searchCommand as AnyCmd, "run", { terms: "auth", limit: "lots" }),
    ).rejects.toThrow(/whole number/);
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
      solutions: [],
      latest_decision: null,
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
});

// ---------------------------------------------------------------------------
// The error envelope round-trip
// ---------------------------------------------------------------------------

describe("server rejections reach the terminal unchanged", () => {
  test("a NOT_FOUND envelope becomes a CruxError with exit code 23", async () => {
    stubServer({ "POST /v1/query": envelope(404, "NOT_FOUND", "solution not found: 9") });

    const err = await runCmd(solutionCommand as AnyCmd, "show", { id: "9", json: true }).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(CruxError);
    expect((err as CruxError).code).toBe("NOT_FOUND");
    expect((err as CruxError).message).toBe("solution not found: 9");
    expect(EXIT_CODES[(err as CruxError).code]).toBe(23);
  });

  test("an ILLEGAL_TRANSITION rejection keeps its code, message and details", async () => {
    stubServer({
      "GET /v1/view": VIEW_WITH_WS,
      "POST /v1/dispatch": envelope(
        422,
        "ILLEGAL_TRANSITION",
        "cannot ship a solution that was not chosen",
        { solutionId: 4, status: "proposed" },
      ),
    });

    const err = (await runCmd(solutionCommand as AnyCmd, "ship", { id: "4", json: true }).catch(
      (e) => e,
    )) as CruxError;

    expect(err).toBeInstanceOf(CruxError);
    expect(err.code).toBe("ILLEGAL_TRANSITION");
    expect(err.details).toEqual({ solutionId: 4, status: "proposed" });
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
  test("a missing url and token names both and the command that fixes them", async () => {
    setApiClient(null);
    const prevUrl = process.env.CRUX_API_URL;
    const prevToken = process.env.CRUX_API_TOKEN;
    const prevHome = process.env.CRUX_HOME;
    delete process.env.CRUX_API_URL;
    delete process.env.CRUX_API_TOKEN;
    process.env.CRUX_HOME = "/nonexistent-crux-home";
    try {
      const err = (await runCmd(workstreamCommand as AnyCmd, "list", { json: true }).catch(
        (e) => e,
      )) as ApiError;
      expect(err.code).toBe("NO_API_CONFIG");
      expect(err.message).toContain("url and token");
      expect(err.message).toContain("crux init");
      expect(EXIT_CODES[err.code]).toBe(2);
    } finally {
      if (prevUrl) process.env.CRUX_API_URL = prevUrl;
      if (prevToken) process.env.CRUX_API_TOKEN = prevToken;
      if (prevHome) process.env.CRUX_HOME = prevHome;
      else delete process.env.CRUX_HOME;
    }
  });

  test("a token alone is not enough, and the missing half is named", async () => {
    setApiClient(null);
    const prevHome = process.env.CRUX_HOME;
    process.env.CRUX_HOME = "/nonexistent-crux-home";
    process.env.CRUX_API_TOKEN = "tok-1";
    try {
      const err = (await runCmd(workstreamCommand as AnyCmd, "list", { json: true }).catch(
        (e) => e,
      )) as ApiError;
      expect(err.message).toContain("[api] url missing");
    } finally {
      delete process.env.CRUX_API_TOKEN;
      if (prevHome) process.env.CRUX_HOME = prevHome;
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
