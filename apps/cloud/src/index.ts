/**
 * Cloud crux — the single Cloudflare Worker (ADR-0004). It serves the liveness
 * probe, the versioned JSON API (`/v1/*`, see `api.ts`), the browser surfaces
 * (`web/router.ts`), and hosts the per-user view-state Durable Object
 * (`view-state-do.ts`).
 */
import astro from "@astrojs/cloudflare/entrypoints/server.js";

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

/**
 * The paths Astro answers for: the docs section, the two Workstream pages that
 * carry islands, and its own hydration payloads under `/_astro/`.
 *
 * The delegation is an explicit list rather than "hand Astro everything and
 * fall through on a 404". Astro answers an unrouted POST with 403 (its CSRF
 * origin check) rather than 404, which would swallow the hand-written form
 * posts — sign-in, invite, tokens — before they ever reached `handleWeb`. A
 * table of what Astro owns is also the honest description of a Worker that has
 * two renderers in it.
 */
const ASTRO_PATHS = [
  /^\/_astro\//,
  /^\/docs(\/|$)/,
  /^\/w\/[^/]+$/,
  /^\/w\/[^/]+\/problems\/[^/]+$/,
];

/**
 * The order is the contract.
 *
 * `/health` and `/v1` come first and unconditionally: the CLI's contract must
 * not be reachable through, or shadowed by, anything the site does. Astro takes
 * the routes it owns next, and the hand-written pages take everything else —
 * they are last because they are the ones that end in a rendered 404 page.
 *
 * This is what "one Worker" (ADR-0004) looks like from the inside: Astro wraps
 * this module rather than replacing it, so the JSON API and the site share a
 * request path, an `Env`, and a Durable Object namespace.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return health(env);

    const api = await handleApi(request, env);
    if (api) return api;

    if (ASTRO_PATHS.some((p) => p.test(pathname))) {
      const rendered = await astro.fetch(request, env, ctx);
      if (rendered.status !== 404) return rendered;
    }

    const web = await handleWeb(request, env);
    if (web) return web;

    return json({ error: "not_found" }, 404);
  },
};
