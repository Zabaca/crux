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
import { authenticateAndResolveScope, mintPrincipal, type Scope } from "@crux/core/auth/principals";
import { CLAIM_TTL_MS, createClaim } from "@crux/core/auth/claims";
import { claimLinkEmail } from "@crux/core/auth/email";
import { observationCapFrom, type Capacity } from "@crux/core/auth/capacity";
import { dispatch, ActionNotAllowedError, getAllowedActions } from "@crux/core/actions";
import { loadViewMetaFromBlob, loadStateFromBlob, formatStateValue } from "@crux/core/view-state";
import { query, type Defer } from "@crux/core/reads";
import { CruxError } from "@crux/core/transitions";
import { ZodError } from "zod";
import { DurableObjectViewStore } from "./view-state-do.js";
// The deployed version, the same one `/health` reports (ADR-0015). It rides in
// an UNKNOWN_KIND refusal so a client that is ahead learns the other half of
// the pair without a second call (ADR-0018).
import pkg from "../package.json" with { type: "json" };
import { emailSenderFor, viewerFor, workspaceName } from "./web/session.js";

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
   * this deployment, which is where claiming lands. */
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
  // The deployment does not implement this kind — which is what 501 means, and
  // it is true whether the client is ahead or hand-rolled with a typo.
  UNKNOWN_KIND: 501,
  // The deployment cannot send the mail claiming depends on, or could not. One
  // is an operator's missing binding, the other is Resend having a bad day;
  // neither is the caller's request being wrong.
  EMAIL_NOT_CONFIGURED: 503,
  EMAIL_SEND_FAILED: 502,
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
    // The version is the deployment's to add: core does not read this package
    // and must not (ADR-0003).
    const details =
      err.code === "UNKNOWN_KIND" ? { ...err.details, version: pkg.version } : err.details;
    return errorBody(err.code, err.message, details);
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
): Promise<{ userId: string; scope: Scope } | null> {
  const token = bearer(request);
  if (token) {
    // Identity and scope in one statement: on D1 the four sequential lookups
    // this used to be cost more than most reads that follow them.
    const authed = await authenticateAndResolveScope(db, token);
    return authed ? { userId: authed.principal.id, scope: authed.scope } : null;
  }

  if (!env.BETTER_AUTH_SECRET) return null;
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin !== url.origin) return null;
  // The browser door has no token row to enter through, so the same joined
  // query is entered at `users` instead — still one statement (ADR-0007), and
  // `viewerFor` has already made it: it is the membership check as well.
  const session = await viewerFor(db, env.BETTER_AUTH_SECRET, url.origin, request);
  if (!session) return null;
  return { userId: session.viewer.id, scope: session.scope };
}

/**
 * Resolve the ViewStateDO stub for whoever this request belongs to.
 *
 * Keyed on the scope's **root** Principal rather than on the requester, because
 * `idFromName` takes one id and since ADR-0013 a corpus belongs to a set. A
 * linked Principal — the normal shape once a second machine has been claimed —
 * would otherwise push into `DO(<itself>)` while the human's browser, which
 * resolves to the root, listened on `DO(<root>)`: two objects, a frame
 * delivered correctly to one nobody was subscribed to.
 *
 * The root is exactly the id `ownerIds` is computed from, so this can never
 * widen the boundary: two Principals share a key only when a claim linked them.
 */
function stubFor(env: Env, scope: Scope): DurableObjectStub {
  return env.VIEW_STATE.get(env.VIEW_STATE.idFromName(scope.rootId));
}

/** Resolve that same object as a ViewStore. */
function viewStoreFor(env: Env, scope: Scope): DurableObjectViewStore {
  return new DurableObjectViewStore(stubFor(env, scope));
}

/**
 * Handle a `/v1/*` request. Returns null for paths this module does not own, so
 * the top-level Worker can fall through to `/health` and 404.
 */
export async function handleApi(
  request: Request,
  env: Env,
  deps: {
    db?: CruxDb;
    /** The request's `ctx.waitUntil`, when there is one. Handed to `query()`, so
     * a recorded read's bookkeeping happens after the response instead of in
     * front of it. Absent, every read keeps waiting for it. */
    defer?: Defer;
  } = {},
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

  // POST /v1/claims — ask to attach an address to the calling Principal
  // (ADR-0013). This only *records* the ask and mails a link; the edge is
  // written when that link comes back, because the address is not proved until
  // it does. Authenticated as the Principal being claimed, so there is no id in
  // the body to get wrong or to guess.
  if (pathname === "/v1/claims" && request.method === "POST") {
    try {
      const body = (await request.json()) as { email?: unknown };
      const email = typeof body.email === "string" ? body.email : "";
      const sendEmail = emailSenderFor(env);
      if (!sendEmail) {
        return errorBody(
          "EMAIL_NOT_CONFIGURED",
          "this deployment cannot send email, so it cannot issue claim links. An operator needs to set RESEND_API_KEY and EMAIL_FROM.",
        );
      }
      const claim = await createClaim(db, { principalId: authed.userId, email });
      const link = `${url.origin}/claim?token=${claim.token}`;
      try {
        await sendEmail({
          to: claim.email,
          ...claimLinkEmail({
            url: link,
            workspace: workspaceName(env, url),
            principalId: authed.userId,
            expiresInMinutes: CLAIM_TTL_MS / 60_000,
          }),
        });
      } catch (err) {
        return errorBody(
          "EMAIL_SEND_FAILED",
          `the claim link could not be sent: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return json(
        { ok: true, email: claim.email, expiresAt: claim.expiresAt, principalId: authed.userId },
        202,
      );
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  // POST /v1/dispatch — every write, straight through dispatch().
  if (pathname === "/v1/dispatch" && request.method === "POST") {
    try {
      const action = await request.json();
      const result = await dispatch(action, {
        db,
        viewStore: viewStoreFor(env, authed.scope),
        actor: { id: authed.userId },
        scope: authed.scope,
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
        scope: authed.scope,
        viewStore: viewStoreFor(env, authed.scope),
        defer: deps.defer,
      });
      return json({ result });
    } catch (err) {
      return toErrorResponse(err);
    }
  }

  // GET /v1/view — the current view-state, same shape as `crux view get`.
  if (pathname === "/v1/view" && request.method === "GET") {
    const store = viewStoreFor(env, authed.scope);
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

  // There is no /v1/view/next and no /v1/view/reset. The view is the human's:
  // it is readable above, and the only thing that moves it is a view action
  // through /v1/dispatch, which is what their own browser and TUI send.

  // GET /v1/view/stream — the push stream, proxied from the user's DO.
  if (pathname === "/v1/view/stream" && request.method === "GET") {
    return stubFor(env, authed.scope).fetch("https://view-state/stream");
  }

  return errorBody("NOT_FOUND", `no such route: ${request.method} ${pathname}`);
}
