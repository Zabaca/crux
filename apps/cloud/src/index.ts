/**
 * Cloud crux — the single Cloudflare Worker (ADR-0004). It serves the liveness
 * probe, the versioned JSON API (`/v1/*`, see `api.ts`), the browser surfaces
 * (`web/router.ts`), and hosts the per-user view-state Durable Object
 * (`view-state-do.ts`).
 */
import { handleApi, type Env } from "./api.js";
import { handleWeb } from "./web/router.js";

export type { Env };
export { ViewStateDO } from "./view-state-do.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Round-trip the D1 binding. A bound-but-unreachable database is the failure
 * this route exists to catch, so it pays for one trivial query rather than
 * reporting "ok" on a Worker that cannot read its corpus.
 */
async function health(env: Env): Promise<Response> {
  try {
    await env.DB.prepare("select 1 as ok").first();
  } catch {
    return json({ status: "degraded", db: "error" }, 503);
  }
  return json({ status: "ok", db: "ok" });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return health(env);

    const api = await handleApi(request, env);
    if (api) return api;

    const web = await handleWeb(request, env);
    if (web) return web;

    return json({ error: "not_found" }, 404);
  },
};
