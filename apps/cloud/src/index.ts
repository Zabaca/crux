/**
 * Cloud crux — the single Cloudflare Worker (ADR-0004). It serves the liveness
 * probe, the versioned JSON API (`/v1/*`, see `api.ts`), the browser surfaces
 * (`web/router.ts`), and hosts the per-user view-state Durable Object
 * (`view-state-do.ts`).
 */
import astro from "@astrojs/cloudflare/entrypoints/server.js";

import { handleApi, type Env } from "./api.js";
import { handleWeb } from "./web/router.js";
import { MARK_SVG } from "./web/brand.js";
import { FAVICON_ICO_BASE64 } from "./web/favicon-ico.js";
import { agentText } from "./web/agent-text.js";

export type { Env };
export { ViewStateDO } from "./view-state-do.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Decoded once per isolate rather than per request — it is 5KB and never changes. */
const FAVICON_ICO = Uint8Array.from(atob(FAVICON_ICO_BASE64), (c) => c.charCodeAt(0));

const ICON_CACHE = "public, max-age=86400";

/**
 * The two favicon routes.
 *
 * They sit here beside `/health` rather than in `web/router.ts` because
 * `handleWeb` builds a D1 client and a Better Auth instance *before* it routes,
 * and answers 503 outright when `BETTER_AUTH_SECRET` is missing. A tab icon
 * should not cost a session lookup, and it should not disappear on a deployment
 * whose browser surfaces are switched off — that deployment still has a CLI, an
 * API and a `/health` page someone is looking at in a tab.
 */
function favicon(pathname: string): Response | null {
  if (pathname === "/favicon.svg") {
    return new Response(MARK_SVG, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": ICON_CACHE },
    });
  }
  if (pathname === "/favicon.ico") {
    return new Response(FAVICON_ICO, {
      headers: { "content-type": "image/x-icon", "cache-control": ICON_CACHE },
    });
  }
  return null;
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
 * The paths Astro answers for: the docs section, the five pages showing corpus
 * data — every one of which carries an island, whether the board, an action bar
 * or just the subscription that keeps it fresh — and Astro's own hydration
 * payloads under `/_astro/`.
 *
 * The account pages are deliberately not here. They show nothing an agent
 * writes, so they have nothing to subscribe to, and two of them (sign-in,
 * claim) are reached without a session at all.
 *
 * The delegation is an explicit list rather than "hand Astro everything and
 * fall through on a 404". Astro answers an unrouted POST with 403 (its CSRF
 * origin check) rather than 404, which would swallow the hand-written form
 * posts — sign-in, invite, tokens — before they ever reached `handleWeb`. A
 * table of what Astro owns is also the honest description of a Worker that has
 * two renderers in it.
 *
 * `/` is the exception that proves the list: Astro renders the Workstream list
 * there for a Member and answers 404 for anybody else, which falls through to
 * the public homepage in `handleWeb` (ADR-0013).
 */
const ASTRO_PATHS = [
  /^\/_astro\//,
  /^\/docs(\/|$)/,
  /^\/$/,
  /^\/w\/[^/]+$/,
  /^\/w\/[^/]+\/problems\/[^/]+$/,
  /^\/w\/[^/]+\/observations$/,
  /^\/w\/[^/]+\/observations\/[^/]+$/,
];

/**
 * Whether Astro answers for this request, rather than `handleWeb`.
 *
 * Every path above is a page or an asset, so every one of them is read with a
 * GET, and the method is part of the test rather than a note about `/`. Astro
 * answers a request it has no route for with its CSRF 403 rather than a 404,
 * which does not fall through — so a POST that matched one of these patterns
 * would be answered by Astro instead of reaching `handleWeb`, which is what
 * `/` (the public homepage) and any future form under `/w/` would notice.
 * Nothing here is written by posting to a page: the browser's writes go to
 * `/v1/dispatch`, which is handled well before this.
 */
function astroOwns(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  return ASTRO_PATHS.some((p) => p.test(pathname));
}

/**
 * The order is the contract.
 *
 * `/health` and `/v1` come first and unconditionally: the CLI's contract must
 * not be reachable through, or shadowed by, anything the site does. The favicon
 * joins them at the front for the same reason in miniature — it is bytes, not a
 * page, and it depends on neither a database nor a session. Astro takes the
 * routes it owns next, and the hand-written pages take everything else — they
 * are last because they are the ones that end in a rendered 404 page.
 *
 * This is what "one Worker" (ADR-0004) looks like from the inside: Astro wraps
 * this module rather than replacing it, so the JSON API and the site share a
 * request path, an `Env`, and a Durable Object namespace.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") return health(env);

    // The plain-text documents, which are what an agent actually reads
    // (`web/agent-text.ts`). They come before the session and the database for
    // the same reason `/health` does: an agent has no cookie and neither
    // document needs a row. `/` falls through to the page only when the caller
    // asked for HTML, so a browser is unaffected and everything automated gets
    // text by default.
    const asText = agentText(request, new URL(request.url), env);
    if (asText) return asText;

    const icon = favicon(pathname);
    if (icon) return icon;

    const api = await handleApi(request, env);
    if (api) return api;

    if (astroOwns(pathname, request.method)) {
      const rendered = await astro.fetch(request, env, ctx);
      if (rendered.status !== 404) return rendered;
    }

    const web = await handleWeb(request, env);
    if (web) return web;

    return json({ error: "not_found" }, 404);
  },
};
