/**
 * The browser half of the Worker: sign-in, invite redemption, the read pages,
 * and the Members / CLI-token screens.
 *
 * Every page except the two that exist because there is no session yet is
 * gated on one — and the gate is the only access check in the file. There is
 * deliberately no second check per Workstream: the deployment is the Workspace
 * and every Member sees all of it (ADR-0003), so a signed-in reader is
 * authorised for every page here by construction.
 *
 * URLs are the addressing scheme: `/w/<slug>/problems/<id>` resolves to the
 * same view in any session, which is what makes a link paste-able into a
 * conversation.
 */
import { createD1Db, type CruxDb } from "@crux/core/db";
import { authUsers } from "@crux/core/db/auth-schema";
import { createAuth, type CruxAuth } from "@crux/core/auth/better-auth";
import { mintToken, revokeToken } from "@crux/core/auth";
import {
  createInvite,
  findPendingInvite,
  acceptInvite,
  listInvites,
  normalizeEmail,
  slugFromEmail,
} from "@crux/core/auth/invites";

import { html, htmlResponse, type Html } from "./html.js";
import { page, type Viewer } from "./layout.js";
import {
  PageNotFound,
  observationPage,
  problemPage,
  solutionPage,
  workstreamListPage,
  workstreamPage,
} from "./read-pages.js";
import { membersPage, tokensPage, signInPage, invitePage } from "./account-pages.js";

export interface WebEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  CRUX_WORKSPACE_NAME?: string;
}

const SESSION_REQUIRED = "/signin";

/** The Workspace's display name — the deployment's host unless one is set. */
function workspaceName(env: WebEnv, url: URL): string {
  return env.CRUX_WORKSPACE_NAME || url.host;
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/**
 * Resolve the browser session to a Member, or null. This is the session half of
 * the identity story whose other half is `authenticateToken` — both land on a
 * row in `users`.
 */
async function viewerFor(auth: CruxAuth, request: Request): Promise<Viewer | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const u = session.user as { id: string; name: string; email: string | null };
  return { id: u.id, name: u.name, email: u.email };
}

function notFoundPage(env: WebEnv, url: URL, viewer: Viewer | null): Response {
  return htmlResponse(
    page({
      title: "Not found",
      viewer,
      workspace: workspaceName(env, url),
      body: html`<h1>Not found</h1>
        <p class="sub">
          Nothing in this Workspace answers to <span class="mono">${url.pathname}</span>.
        </p>
        <p><a href="/">Back to Workstreams</a></p>`,
    }),
    404,
  );
}

/**
 * Handle a browser request. Returns null for paths this module does not own so
 * the Worker can fall through to `/health`, `/v1` and its plain 404.
 */
export async function handleWeb(
  request: Request,
  env: WebEnv,
  deps: { db?: CruxDb } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/health" || path === "/v1" || path.startsWith("/v1/")) return null;

  const db = deps.db ?? createD1Db(env.DB);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) {
    return htmlResponse(
      page({
        title: "Not configured",
        viewer: null,
        workspace: workspaceName(env, url),
        body: html`<h1>Not configured</h1>
          <p class="sub">
            This deployment has no <span class="mono">BETTER_AUTH_SECRET</span>, so it cannot issue
            browser sessions. The JSON API and the CLI are unaffected.
          </p>`,
      }),
      503,
    );
  }
  const auth = createAuth(db, { secret, baseURL: url.origin });

  // Better Auth owns everything under its basePath.
  if (path.startsWith("/api/auth")) return auth.handler(request);

  const viewer = await viewerFor(auth, request);
  const workspace = workspaceName(env, url);
  const render = (r: { title: string; body: Html }, status = 200): Response =>
    htmlResponse(page({ title: r.title, viewer, workspace, body: r.body }), status);

  // ---- routes that exist because there is no session yet --------------------

  if (path === "/signin" && request.method === "POST") {
    // Better Auth answers `sign-in/email` with 200 and a JSON body even when
    // asked to redirect, which a plain HTML form would render as JSON. So the
    // form posts here and this turns the result into a real navigation.
    const form = await request.formData();
    const next = safeNext(String(form.get("next") ?? "")) ?? "/";
    const signIn = await auth.api.signInEmail({
      body: {
        email: normalizeEmail(String(form.get("email") ?? "")),
        password: String(form.get("password") ?? ""),
      },
      asResponse: true,
    });
    if (!signIn.ok) {
      return render(signInPage({ next, error: "That email and password did not match." }), 401);
    }
    const headers = new Headers();
    for (const cookie of signIn.headers.getSetCookie()) headers.append("set-cookie", cookie);
    headers.set("location", next);
    return new Response(null, { status: 302, headers });
  }

  if (path === "/signin") {
    if (viewer) return redirect(safeNext(url.searchParams.get("next")) ?? "/");
    return render(signInPage({ next: safeNext(url.searchParams.get("next")) }));
  }

  if (path === "/signout") {
    await auth.api.signOut({ headers: request.headers });
    return redirect("/signin");
  }

  if (path === "/invite") {
    const token = url.searchParams.get("token");
    const invite = await findPendingInvite(db, token);
    if (!invite) {
      return render(
        invitePage({
          invalid: "This invite link is not valid — it may have been used already, or expired.",
        }),
        410,
      );
    }
    return render(invitePage({ email: invite.email, token: token! }));
  }

  if (path === "/invite/accept" && request.method === "POST") {
    return acceptInviteRequest(request, db, auth, { env, url, viewer, workspace });
  }

  // ---- everything below is Members-only ------------------------------------

  if (!viewer) {
    return redirect(`${SESSION_REQUIRED}?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  try {
    if (path === "/") return render(await workstreamListPage(db));

    if (path === "/members") return render(await membersPage(db, viewer));
    if (path === "/members/invite" && request.method === "POST") {
      const form = await request.formData();
      const email = normalizeEmail(String(form.get("email") ?? ""));
      if (!email.includes("@")) {
        return render(
          await membersPage(db, viewer, { error: "That is not an email address." }),
          400,
        );
      }
      const invite = await createInvite(db, { email, invitedById: viewer.id });
      const link = `${url.origin}/invite?token=${invite.token}`;
      return render(await membersPage(db, viewer, { inviteLink: link, invitedEmail: email }));
    }

    if (path === "/tokens") return render(await tokensPage(db, viewer));
    if (path === "/tokens/mint" && request.method === "POST") {
      const form = await request.formData();
      const name = String(form.get("name") ?? "").trim() || null;
      const minted = await mintToken(db, { userId: viewer.id, ...(name ? { name } : {}) });
      return render(await tokensPage(db, viewer, { minted: minted.token }));
    }
    if (path === "/tokens/revoke" && request.method === "POST") {
      const form = await request.formData();
      const id = String(form.get("id") ?? "");
      await revokeToken(db, id);
      return render(await tokensPage(db, viewer, { revoked: id }));
    }

    const w = /^\/w\/([^/]+)$/.exec(path);
    if (w) return render(await workstreamPage(db, decodeURIComponent(w[1]!)));

    const prob = /^\/w\/([^/]+)\/problems\/([^/]+)$/.exec(path);
    if (prob) {
      return render(
        await problemPage(db, decodeURIComponent(prob[1]!), decodeURIComponent(prob[2]!)),
      );
    }

    const sol = /^\/w\/([^/]+)\/solutions\/([^/]+)$/.exec(path);
    if (sol) {
      return render(
        await solutionPage(db, decodeURIComponent(sol[1]!), decodeURIComponent(sol[2]!)),
      );
    }

    const obs = /^\/w\/([^/]+)\/observations\/([^/]+)$/.exec(path);
    if (obs) {
      return render(
        await observationPage(db, decodeURIComponent(obs[1]!), decodeURIComponent(obs[2]!)),
      );
    }
  } catch (err) {
    if (err instanceof PageNotFound) return notFoundPage(env, url, viewer);
    throw err;
  }

  return notFoundPage(env, url, viewer);
}

/**
 * Redeem an invite: create the Member's account, then mark the invite used.
 *
 * The order matters. `acceptInvite` is conditional on the invite still being
 * pending, so if two people open the same link at once only one of them gets
 * past it; the loser's freshly created account is refused a session and told
 * the link is spent rather than silently becoming a Member.
 */
async function acceptInviteRequest(
  request: Request,
  db: CruxDb,
  auth: CruxAuth,
  ctx: { env: WebEnv; url: URL; viewer: Viewer | null; workspace: string },
): Promise<Response> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const password = String(form.get("password") ?? "");

  const invite = await findPendingInvite(db, token);
  const fail = (message: string, status: number): Response =>
    htmlResponse(
      page({
        title: "Invite",
        viewer: null,
        workspace: ctx.workspace,
        body: invitePage({ email: invite?.email, token, error: message }).body,
      }),
      status,
    );

  if (!invite)
    return fail("This invite link is not valid — it may be used already, or expired.", 410);
  if (!name) return fail("Please give a name to attribute your entries to.", 400);
  if (password.length < 10) return fail("Passwords must be at least 10 characters.", 400);

  const signUp = await auth.api.signUpEmail({
    body: {
      email: invite.email,
      password,
      name,
      slug: await uniqueSlug(db, slugFromEmail(invite.email)),
    },
    asResponse: true,
  });
  if (!signUp.ok) {
    return fail("Could not create that account — the address may already be a Member.", 400);
  }

  const created = (await signUp.clone().json()) as { user?: { id?: string } };
  const userId = created.user?.id;
  if (!userId || !(await acceptInvite(db, { inviteId: invite.id, userId }))) {
    return fail("This invite link was just used by someone else.", 409);
  }

  // Carry Better Auth's session cookies onto the redirect, so redeeming an
  // invite signs the new Member in rather than dropping them at a login form.
  const headers = new Headers();
  for (const cookie of signUp.headers.getSetCookie()) headers.append("set-cookie", cookie);
  headers.set("location", "/");
  return new Response(null, { status: 302, headers });
}

/** `users.slug` is unique; add a suffix until it is. */
async function uniqueSlug(db: CruxDb, base: string): Promise<string> {
  const existing = await listSlugs(db);
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

async function listSlugs(db: CruxDb): Promise<Set<string>> {
  const rows = await db.select({ slug: authUsers.slug }).from(authUsers);
  return new Set(rows.map((r) => r.slug));
}

/** Only same-origin paths survive, so `?next=` cannot bounce off this site. */
function safeNext(next: string | null): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

/** Re-exported so tests and the invite flow share one list of pending invites. */
export { listInvites };
