import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import worker, { type Env } from "./index";
import { handleApi } from "./api";
import { ViewStateDO } from "./view-state-do";
import { createTestDb, type TestDb } from "@crux/core/db/test-utils";
import { users } from "@crux/core/db/schema";
import { mintToken } from "@crux/core/auth";
import type { CruxDb } from "@crux/core/db";

// The seam: the Worker's fetch handler, (Request, Env) => Response, plus the
// `handleApi(request, env, {db})` seam that lets an in-memory libSQL db stand in
// for the D1 binding. Every surface cloud crux grows enters here.

/** A D1 binding double: only `prepare(...).first()` is on the /health path. */
function d1(first: () => Promise<unknown>): D1Database {
  return { prepare: () => ({ first }) } as unknown as D1Database;
}

/**
 * A VIEW_STATE namespace double backed by real ViewStateDO instances over
 * in-memory storage — so the Durable Object's own logic runs under bun.
 */
function fakeViewState(): DurableObjectNamespace {
  const instances = new Map<string, ViewStateDO>();
  return {
    idFromName: (name: string) => ({ name }) as unknown as DurableObjectId,
    get: (id: { name: string }) => {
      let inst = instances.get(id.name);
      if (!inst) {
        const map = new Map<string, unknown>();
        inst = new ViewStateDO({
          storage: {
            get: async <T>(k: string) => map.get(k) as T | undefined,
            put: async <T>(k: string, v: T) => void map.set(k, v),
          },
        });
        instances.set(id.name, inst);
      }
      const bound = inst;
      return {
        fetch: (input: string, init?: RequestInit) => bound.fetch(new Request(input, init)),
      } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

function env(overrides: Partial<Env> = {}): Env {
  return { DB: d1(() => Promise.resolve({ ok: 1 })), VIEW_STATE: fakeViewState(), ...overrides };
}

describe("GET /health", () => {
  test("reports the deployment is up and the D1 binding answers", async () => {
    const res = await worker.fetch(new Request("https://crux.example/health"), env());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  test("reports degraded when the D1 binding fails", async () => {
    const broken = env({ DB: d1(() => Promise.reject(new Error("no such database"))) });
    const res = await worker.fetch(new Request("https://crux.example/health"), broken);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "error" });
  });
});

describe("bearer auth on /v1", () => {
  let t: TestDb;
  let token: string;

  beforeEach(async () => {
    t = await createTestDb();
    await t.db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
    token = (await mintToken(t.db as unknown as CruxDb, { userId: "USR-james" })).token;
  });
  afterEach(() => t.cleanup());

  const req = (init?: RequestInit) => new Request("https://crux.example/v1/view", init);
  const call = (r: Request) => handleApi(r, env(), { db: t.db as unknown as CruxDb });

  test("a valid token authenticates", async () => {
    const res = await call(req({ headers: { authorization: `Bearer ${token}` } }));
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { revision: number };
    expect(body.revision).toBe(0);
  });

  test("an absent token is rejected", async () => {
    const res = await call(req());
    expect(res!.status).toBe(401);
    expect((await res!.json()) as Record<string, unknown>).toEqual({
      error: { code: "UNAUTHENTICATED", message: "missing or invalid bearer token" },
    });
  });

  test("an invalid token is rejected", async () => {
    const res = await call(req({ headers: { authorization: "Bearer crux_bogus" } }));
    expect(res!.status).toBe(401);
  });
});

describe("POST /v1/dispatch — writes through dispatch(), view-state in the DO", () => {
  let t: TestDb;
  let token: string;
  let e: Env;

  beforeEach(async () => {
    t = await createTestDb();
    await t.db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
    await t.db
      .insert((await import("@crux/core/db/schema")).workstreams)
      .values({ id: "WS-crux", slug: "crux", title: "Crux" });
    token = (await mintToken(t.db as unknown as CruxDb, { userId: "USR-james" })).token;
    e = env();
  });
  afterEach(() => t.cleanup());

  const dispatchReq = (action: unknown) =>
    new Request("https://crux.example/v1/dispatch", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(action),
    });

  test("a view action advances view-state and bumps the revision in the DO", async () => {
    const res = await handleApi(
      dispatchReq({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } }),
      e,
      { db: t.db as unknown as CruxDb },
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { revision: number };
    expect(body.revision).toBe(1);

    // The next request, same user, sees the persisted state — proving the DO holds it.
    const view = await handleApi(
      new Request("https://crux.example/v1/view", {
        headers: { authorization: `Bearer ${token}` },
      }),
      e,
      { db: t.db as unknown as CruxDb },
    );
    const viewBody = (await view!.json()) as { revision: number; stateLabel: string };
    expect(viewBody.revision).toBe(1);
    expect(viewBody.stateLabel).toContain("workstream_dashboard");
  });

  test("a mutation is attributed to the token's user and persisted", async () => {
    const res = await handleApi(
      dispatchReq({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-crux", title: "P", description: "d" },
      }),
      e,
      { db: t.db as unknown as CruxDb },
    );
    expect(res!.status).toBe(200);
    const body = (await res!.json()) as { result: { ok: boolean; id: number } };
    expect(body.result.ok).toBe(true);

    const { problems } = await import("@crux/core/db/schema");
    const rows = await t.db.select().from(problems);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdById).toBe("USR-james");
  });

  test("a transition rejection surfaces as an error envelope", async () => {
    // OPEN_PROBLEM for a problem that does not exist → view refused.
    const res = await handleApi(
      dispatchReq({ kind: "OPEN_PROBLEM", payload: { slug: "999" } }),
      e,
      {
        db: t.db as unknown as CruxDb,
      },
    );
    const body = (await res!.json()) as { error?: { code: string } };
    expect(res!.status).toBeGreaterThanOrEqual(400);
    expect(body.error?.code).toBeDefined();
  });
});

describe("ViewStateDO", () => {
  function makeDO() {
    const map = new Map<string, unknown>();
    return new ViewStateDO({
      storage: {
        get: async <T>(k: string) => map.get(k) as T | undefined,
        put: async <T>(k: string, v: T) => void map.set(k, v),
      },
    });
  }

  test("read returns {} before any write, then round-trips a written blob", async () => {
    const doInst = makeDO();
    const before = await doInst.fetch(new Request("https://view-state/read"));
    expect(await before.json()).toEqual({});

    await doInst.fetch(
      new Request("https://view-state/write", {
        method: "PUT",
        body: JSON.stringify({ revision: 4, value: { viewing: "workstream_list" } }),
      }),
    );
    const after = await doInst.fetch(new Request("https://view-state/read"));
    expect((await after.json()) as Record<string, unknown>).toEqual({
      revision: 4,
      value: { viewing: "workstream_list" },
    });
  });

  test("exposes an SSE push stream", async () => {
    const doInst = makeDO();
    const res = await doInst.fetch(new Request("https://view-state/stream"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
