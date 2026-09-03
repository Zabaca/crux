/**
 * The session gate for callers that need a viewer and what that viewer may
 * read: the Astro pages, and `/v1` when the browser writes through it.
 *
 * `router.ts` has the sign-in, sign-out and invite flows and so holds the Better
 * Auth instance itself; everything else gets a viewer from here. The point is
 * that "signed in, or bounced to `/signin?next=…`" is one rule — an Astro page
 * that rolled its own gate is precisely how a page ends up readable without a
 * session.
 */
import { createD1Db, type CruxDb } from "@crux/core/db";
import { createAuth } from "@crux/core/auth/better-auth";
import { resendSender, type EmailSender } from "@crux/core/auth/email";
import { resolveActiveScope, type Scope } from "@crux/core/auth/principals";
import type { ReadContext } from "@crux/core/reads";

import type { Env } from "../api.js";
import type { Viewer } from "./layout.js";

/** The bindings the browser surfaces read — a subset of the Worker's `Env`. */
export type WebEnv = Pick<
  Env,
  | "DB"
  | "BETTER_AUTH_SECRET"
  | "CRUX_WORKSPACE_NAME"
  | "RESEND_API_KEY"
  | "EMAIL_FROM"
  // The homepage quotes the free allowance, and reads it from the same var the
  // cap enforces so a raised cap cannot leave the page stating the old number.
  | "CRUX_OBSERVATION_CAP"
>;

/**
 * The deployment's email sender, or null if it has not been given one.
 *
 * Both halves are required and neither has a sane default: a key without a
 * from-address cannot send, and a from-address on a domain the key's Resend
 * account has not verified is refused at send time. Returning null lets the
 * sign-in page say so plainly, which is the same shape as a missing
 * `BETTER_AUTH_SECRET` — the deployment stays up and only the surface that
 * needs the missing thing declines.
 */
export function emailSenderFor(env: WebEnv): EmailSender | null {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  return resendSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
}

/** The Workspace's display name — the deployment's host unless one is set. */
export function workspaceName(env: WebEnv, url: URL): string {
  return env.CRUX_WORKSPACE_NAME || url.host;
}

/** Where an unauthenticated request to `url` gets sent. */
export function signInRedirect(url: URL): Response {
  const next = encodeURIComponent(url.pathname + url.search);
  return new Response(null, { status: 302, headers: { location: `/signin?next=${next}` } });
}

/** A resolved browser session: who is looking, and what they may read. */
export type Session = { viewer: Viewer; scope: Scope };

/**
 * Resolve the browser session to a Member and their scope, or null. This is the
 * session half of the identity story whose other half is
 * `authenticateAndResolveScope` — both land on a row in `users` (ADR-0007), and
 * both refuse a row that has been removed from the Workspace.
 *
 * The membership check and the scope are one statement, not two. The session
 * outlives the membership it was minted for, so Better Auth checking the cookie
 * is not enough — whether the person is still in the Workspace has to be asked
 * of the corpus on every request (ADR-0011). `resolveActiveScope` asks exactly
 * that as its `where` clause and answers with the scope as well, so the check
 * that used to be its own round trip is now a side effect of the one this
 * request was going to make anyway.
 */
export async function viewerFor(
  db: CruxDb,
  secret: string,
  origin: string,
  request: Request,
): Promise<Session | null> {
  // No sender: this instance only reads a session cookie. Nothing it can reach
  // sends mail, so leaving it out is a statement, not an omission.
  const auth = createAuth(db, { secret, baseURL: origin });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const u = session.user as { id: string; name: string; email: string | null };
  const scope = await resolveActiveScope(db, { id: u.id });
  // Null is "no longer a Member", which is not the same as "a Member who owns
  // nothing" — that arrives as a scope with an empty corpus and renders.
  if (!scope) return null;
  return { viewer: { id: u.id, name: u.name, email: u.email }, scope };
}

/** What an Astro page needs to render inside the shell, or the reason it can't. */
export type PageContext =
  | {
      ok: true;
      /** Hand this to every `query()` on the page: the scope is resolved once,
       * here, and re-resolving it per read is what this carries it to avoid. */
      read: ReadContext;
      /** The same row as `read.principal`, with the name and address the shell
       * prints. Reads take `read`; the layout takes this. */
      viewer: Viewer;
      workspace: string;
    }
  | { ok: false; response: Response };

/**
 * Everything a Members-only Astro page needs, or the Response to return instead:
 * a 503 when the deployment cannot issue sessions, a redirect when there is no
 * session yet.
 */
export async function pageContext(env: WebEnv, request: Request): Promise<PageContext> {
  const url = new URL(request.url);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    return {
      ok: false,
      response: new Response("This deployment has no BETTER_AUTH_SECRET.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    };
  }
  const db = createD1Db(env.DB);
  const session = await viewerFor(db, secret, url.origin, request);
  if (!session) return { ok: false, response: signInRedirect(url) };
  return {
    ok: true,
    read: { db, principal: session.viewer, scope: session.scope },
    viewer: session.viewer,
    workspace: workspaceName(env, url),
  };
}
