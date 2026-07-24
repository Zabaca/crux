/**
 * Cloud crux — the single Cloudflare Worker (ADR-0004). Static assets, the JSON
 * API and auth all ship from here; for now it is a stub that proves the deploy
 * pipeline end to end.
 */

export interface Env {
  /** D1 binding — the cloud corpus. Empty until CRUX-B2IA0X applies the schema. */
  DB: D1Database;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Round-trip the D1 binding. A bound-but-unreachable database is the failure
 * this stub exists to catch, so the health route pays for one trivial query
 * rather than reporting "ok" on a Worker that cannot read its corpus.
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

    return json({ error: "not_found" }, 404);
  },
};
