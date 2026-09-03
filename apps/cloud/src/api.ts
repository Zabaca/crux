/**
 * The versioned JSON API (`/v1/*`). Every route but one is bearer-authenticated:
 * the CLI presents `Authorization: Bearer <token>`, the token resolves to a
 * users row, and that row is the Principal — the actor for the request and the
 * boundary of what it can see (ADR-0013). The exception is `POST /v1/principals`,
 * which is how a client with no credentials gets one. Writes go through core's
 * `dispatch()` — no invariant is reimplemented here — with view-state living in
 * the caller's ViewStateDO. Reads mirror the CLI's `--json` shapes exactly.
 */
import { createD1Db, type CruxDb } from "@crux/core/db";
import { authenticateToken } from "@crux/core/auth";
import { mintPrincipal } from "@crux/core/auth/principals";
import { observationCapFrom, type Capacity } from "@crux/core/auth/capacity";
import { dispatch, ActionNotAllowedError, getAllowedActions } from "@crux/core/actions";
import {
  loadViewMetaFromBlob,
  loadStateFromBlob,
  formatStateValue,
  nextEvents,
  resetStateWithStore,
  VIEW_EVENT_PAYLOAD_HINTS,
  type ViewEvent,
} from "@crux/core/view-state";
import { query } from "@crux/core/reads";
import { CruxError } from "@crux/core/transitions";
import { ZodError } from "zod";
import { DurableObjectViewStore } from "./view-state-do.js";
import { viewerFor } from "./web/session.js";

export interface Env {
  DB: D1Database;
  VIEW_STATE: DurableObjectNamespace;
  /** Signing key for browser sessions; absent means the web surfaces are off. */
  BETTER_AUTH_SECRET?: string;
  /** Display name for the Workspace; defaults to the deployment's host. */
  CRUX_WORKSPACE_NAME?: string;
  /** Resend key for sign-in links; absent means nobody can sign in to the browser. */
  RESEND_API_KEY?: string;
  /** The address sign-in links are sent from, on a domain Resend has verified. */
  EMAIL_FROM?: string;
  /** Observations an unclaimed Principal may file before writes refuse
   * (ADR-0013). A deployment tunes the allowance here rather than in code;
   * absent or unparseable means core's default. */
  CRUX_OBSERVATION_CAP?: string;
  /** Where a capped Principal is sent to claim itself. Defaults to `/claim` on
   * this deployment, which is where claiming lands (CRUX-VIZW40). */
  CRUX_CLAIM_URL?: string;
}

/** The allowance this deployment writes against, resolved per request. */
function capacityFor(env: Env, url: URL): Capacity {
  return {
    observationCap: observationCapFrom(env.CRUX_OBSERVATION_CAP),
    // `||`, not `??`: a var set to the empty string is a var nobody filled in,
    // and a refusal that names nowhere is worse than one that names this host.
    claimUrl: env.CRUX_CLAIM_URL || new URL("/claim", url.origin).toString(),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** HTTP status for each stable error code. The CLI reconstructs the error from
 * the envelope's `code`, so the status is advisory — the body is the contract. */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  ACTION_NOT_ALLOWED: 409,
  ALREADY_EXISTS: 409,
  ILLEGAL_TRANSITION: 422,
  // The allowance is spent, not the request malformed: 429 is the status whose
  // meaning is "you, later" rather than "this, never".
  CAPACITY_EXCEEDED: 429,
  INVARIANT_VIOLATION: 422,
  REFERENTIAL_MISMATCH: 422,
  UNKNOWN: 500,
};

function errorBody(code: string, message: string, details?: unknown): Response {
  const body =
    details === undefined ? { error: { code, message } } : { error: { code, message, details } };
  return json(body, STATUS_BY_CODE[code] ?? 500);
}

/** Map any thrown error to the same `{error:{code,message,details}}` envelope the
 * CLI's local path produces, so a server-side rejection reads identically. */
function toErrorResponse(err: unknown): Response {
  if (err instanceof ActionNotAllowedError) {
    return errorBody(err.code, err.message, {
      state: err.state,
      attempted: err.attempted,
      allowedView: err.allowedView,
      allowedMutation: err.allowedMutation,
      globals: err.globals,
    });
  }
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return errorBody("VALIDATION_ERROR", message, { issues: err.issues });
  }
  if (err instanceof CruxError) {
    return errorBody(err.code, err.message, err.details);
  }
  const message = err instanceof Error ? err.message : String(err);
  return errorBody("UNKNOWN", message);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1]!.trim() : null;
}

/**
 * Resolve the caller to a users row, by either front door (ADR-0007).
 *
 * The CLI presents a bearer token. The browser presents its Better Auth session
 * cookie — which is what lets the board and the action dialogs write through
 * `/v1` instead of growing a second, cookie-only write path beside it. There is
 * one dispatch endpoint, so there is one place the invariants run.
 *
 * A cookie is ambient credential, so a cookie-authenticated request must also
 * be same-origin: without that check any page on the internet could POST a
 * transition into this deployment on a signed-in Member's behalf. The CLI is
 * unaffected — a bearer token is never sent by a browser it did not come from.
 */
async function authenticate(
  request: Request,
  env: Env,
  db: CruxDb,
  url: URL,
): Promise<{ userId: string } | null> {
  const token = bearer(request);
  if (token) return authenticateToken(db, token);

  if (!env.BETTER_AUTH_SECRET) return null;
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin !== url.origin) return null;
  const viewer = await viewerFor(db, env.BETTER_AUTH_SECRET, url.origin, request);
  return viewer ? { userId: viewer.id } : null;
}

/** Resolve the per-user ViewStateDO stub. */
function stubFor(env: Env, userId: string): DurableObjectStub {
  return env.VIEW_STATE.get(env.VIEW_STATE.idFromName(userId));
}

/** Resolve the per-user ViewStateDO as a ViewStore. */
function viewStoreFor(env: Env, userId: string): DurableObjectViewStore {
  return new DurableObjectViewStore(stubFor(env, userId));
}

/**
 * Handle a `/v1/*` request. Returns null for paths this module does not own, so
 * the top-level Worker can fall through to `/health` and 404.
 */
export async function handleApi(
  request: Request,
  env: Env,
  deps: { db?: CruxDb } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname !== "/v1" && !pathname.startsWith("/v1/")) return null;

  const db = deps.db ?? createD1Db(env.DB);

  // POST /v1/principals — mint an anonymous Principal. Deliberately before the
  // authentication gate and deliberately open: this is what a machine with no
  // configuration calls, so there is nothing to authenticate it with (ADR-0013).
  // The token comes back once and is never recoverable, exactly like a minted
  // CLI token.
  if (pathname === "/v1/principals" && request.method === "POST") {
    try {
      const minted = await mintPrincipal(db);
      return json(
        {
          principal: { id: minted.principalId, name: minted.name },
          token: minted.token,
          tokenId: minted.tokenId,
        },
        201,
      );
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  const authed = await authenticate(request, env, db, url);
  if (!authed) {
    return errorBody("UNAUTHENTICATED", "missing or invalid bearer token");
  }

  // POST /v1/dispatch — every write, straight through dispatch().
  if (pathname === "/v1/dispatch" && request.method === "POST") {
    try {
      const action = await request.json();
      const result = await dispatch(action, {
        db,
        viewStore: viewStoreFor(env, authed.userId),
        actor: { id: authed.userId },
        capacity: capacityFor(env, url),
      });
      return json(result);
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  // POST /v1/query — every read, straight through query().
  if (pathname === "/v1/query" && request.method === "POST") {
    try {
      const result = await query(await request.json(), {
        db,
        // The Principal comes from the credential the server just resolved, not
        // from the body. A read that took its own scope as an argument would be
        // no scope at all.
        principal: { id: authed.userId },
        viewStore: viewStoreFor(env, authed.userId),
      });
      return json({ result });
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  // GET /v1/view — the current view-state, same shape as `crux view get`.
  if (pathname === "/v1/view" && request.method === "GET") {
    const store = viewStoreFor(env, authed.userId);
    const blob = await store.read();
    const meta = loadViewMetaFromBlob(blob);
    const snap = loadStateFromBlob(blob);
    const allowed = getAllowedActions(snap.value);
    return json({
      value: snap.value,
      context: snap.context,
      revision: meta.revision,
      lastAction: meta.lastAction,
      allowedActions: [...allowed.allowedView, ...allowed.allowedMutation],
      globalActions: allowed.globals,
      stateLabel: formatStateValue(snap.value),
    });
  }

  // GET /v1/view/next — legal events from the current state, with payload hints.
  if (pathname === "/v1/view/next" && request.method === "GET") {
    const snap = loadStateFromBlob(await viewStoreFor(env, authed.userId).read());
    return json({
      value: snap.value,
      events: nextEvents(snap).map((type) => ({
        type,
        payload: VIEW_EVENT_PAYLOAD_HINTS[type as ViewEvent["type"]] ?? null,
      })),
    });
  }

  // POST /v1/view/reset — back to the initial state.
  if (pathname === "/v1/view/reset" && request.method === "POST") {
    const snap = await resetStateWithStore(viewStoreFor(env, authed.userId));
    return json({ ok: true, value: snap.value, context: snap.context });
  }

  // GET /v1/view/stream — the push stream, proxied from the user's DO.
  if (pathname === "/v1/view/stream" && request.method === "GET") {
    return stubFor(env, authed.userId).fetch("https://view-state/stream");
  }

  return errorBody("NOT_FOUND", `no such route: ${request.method} ${pathname}`);
}
