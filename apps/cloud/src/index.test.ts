import { describe, expect, test } from "bun:test";
import worker, { type Env } from "./index";

// The seam: the Worker's fetch handler, (Request, Env) => Response. Every
// surface cloud crux grows — the Astro site, the JSON API, auth — enters here,
// so this is the only interface these tests touch.

/** A D1 binding double: only `prepare(...).first()` is on the handler's path. */
function d1(first: () => Promise<unknown>): D1Database {
  return { prepare: () => ({ first }) } as unknown as D1Database;
}

function env(overrides: Partial<Env> = {}): Env {
  return { DB: d1(() => Promise.resolve({ ok: 1 })), ...overrides };
}

describe("GET /health", () => {
  test("reports the deployment is up and the D1 binding answers", async () => {
    const res = await worker.fetch(new Request("https://crux.example/health"), env());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  test("reports degraded when the D1 binding fails", async () => {
    const broken = env({ DB: d1(() => Promise.reject(new Error("no such database"))) });

    const res = await worker.fetch(new Request("https://crux.example/health"), broken);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "error" });
  });
});
