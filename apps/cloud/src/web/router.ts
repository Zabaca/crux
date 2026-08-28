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
import { createAuth, type CruxAuth } from "@crux/core/auth/better-auth";
import { mintToken, revokeToken } from "@crux/core/auth";
import {
  createInvite,
  findPendingInvite,
  acceptInvite,
  normalizeEmail,
} from "@crux/core/auth/invites";

import { html, htmlResponse, type Html } from "./html.js";
import { workspaceName, type WebEnv } from "./session.js";
import { page, type Viewer } from "./layout.js";
import {
  PageNotFound,
  observationListPage,
  observationPage,
  solutionPage,
  workstreamListPage,
} from "./read-pages.js";
import { membersPage, tokensPage, signInPage, invitePage, linkSentPage } from "./account-pages.js";
import {
  ensureMember,
  findMemberByEmail,
  isActiveMember,
  listMembers,
  removeMember,
} from "@crux/core/auth/membership";
import { emailSenderFor } from "./session.js";

export type { WebEnv };

const SESSION_REQUIRED = "/signin";

const NO_EMAIL_SENDER =
  "This deployment cannot send email, so it cannot issue sign-in links. An operator needs to set RESEND_API_KEY and EMAIL_FROM.";

type SignInLinkOutcome = "sent" | "not-a-member" | "send-failed";

/**
 * Mail a sign-in link to `email`, if that address is a Member.
 *
 * Membership is checked here rather than left to the plugin because the
 * plugin's own gate runs at verify time (see `findMemberByEmail`). The caller
 * renders the same page for `sent` and `not-a-member` on purpose — this
 * function distinguishes them so the *failure* case can be reported honestly,
 * not so the answer can vary by address.
 */
async function sendSignInLink(
  db: CruxDb,
  auth: CruxAuth,
  opts: { email: string; callbackURL: string; headers: Headers },
): Promise<SignInLinkOutcome> {
  const member = await findMemberByEmail(db, opts.email);
  if (!member) return "not-a-member";
  try {
    await auth.api.signInMagicLink({
      body: { email: opts.email, callbackURL: opts.callbackURL },
      // The endpoint requires them; Better Auth reads the origin and the rate
      // limiter's client address out of here.
      headers: opts.headers,
    });
    return "sent";
  } catch {
    // Delivery failed, the signing key is wrong, Resend refused the from
    // address — all of it is "we could not send it", and none of it is
    // something the person at the form can act on beyond trying again.
    return "send-failed";
  }
}

/**
 * The linkable read surfaces, as pattern → loader. Each capture group becomes a
 * decoded argument, so the four of them differ only in their URL and their page
 * — which is the whole of the difference, and worth keeping visible as a table.
 */
const READ_ROUTES: ReadonlyArray<
  readonly [RegExp, (db: CruxDb, ...params: string[]) => Promise<{ title: string; body: Html }>]
> = [
  // `/w/<slug>` and `/w/<slug>/problems/<id>` are not here: both moved to Astro
  // routes so they can carry hydrated islands — the roadmap board and the
  // action bar. `problemPage()` below is still what the latter renders. A slug
  // or id that names nothing still lands back here, as the 404 page.
  [/^\/w\/([^/]+)\/solutions\/([^/]+)$/, (db, slug, id) => solutionPage(db, slug!, id!)],
  [/^\/w\/([^/]+)\/observations$/, (db, slug) => observationListPage(db, slug!)],
  [/^\/w\/([^/]+)\/observations\/([^/]+)$/, (db, slug, id) => observationPage(db, slug!, id!)],
];

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/**
 * Resolve the browser session to a Member, or null.
 *
 * `session.ts` has the same resolution for callers that only need a viewer.
 * This one takes the `auth` instance because this file already built one — it
 * needs it for sign-in, sign-out and invite redemption, and building a second
 * would be two Better Auth instances answering for one deployment.
 *
 * A valid session is not yet a viewer: the row it names may have been removed
 * since, and Better Auth has no opinion about that. `isActiveMember` is the
 * second half of the question, and asking it here is what makes a removal take
 * effect on the removed Member's *next request* rather than at their next
 * sign-in.
 */
async function viewerFor(db: CruxDb, auth: CruxAuth, request: Request): Promise<Viewer | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const u = session.user as { id: string; name: string; email: string | null };
  if (!(await isActiveMember(db, u.id))) return null;
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

  // `/w/<slug>/board` was a second, smaller copy of `/w/<slug>`; the two are one
  // page now. Permanent, and before the session gate, because the URL is gone
  // rather than protected — a bookmark should land on the page, not a sign-in
  // for a path that no longer exists.
  const board = /^\/w\/([^/]+)\/board$/.exec(path);
  if (board) return redirect(`/w/${board[1]}`, 301);

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
  const workspace = workspaceName(env, url);
  const sendEmail = emailSenderFor(env);
  const auth = createAuth(db, {
    secret,
    baseURL: url.origin,
    workspace,
    ...(sendEmail ? { sendEmail } : {}),
  });

  // Better Auth owns everything under its basePath — including the
  // `magic-link/verify` route the link in the mail points at, which is why
  // signing in needs no route of its own below.
  if (path.startsWith("/api/auth")) return auth.handler(request);

  const viewer = await viewerFor(db, auth, request);
  const render = (r: { title: string; body: Html }, status = 200): Response =>
    htmlResponse(page({ title: r.title, viewer, workspace, body: r.body }), status);

  // ---- routes that exist because there is no session yet --------------------

  if (path === "/signin" && request.method === "POST") {
    const form = await request.formData();
    const next = safeNext(String(form.get("next") ?? "")) ?? "/";
    const email = normalizeEmail(String(form.get("email") ?? ""));
    if (!email.includes("@")) {
      return render(signInPage({ next, error: "That is not an email address." }), 400);
    }
    if (!sendEmail) {
      return render(signInPage({ next, error: NO_EMAIL_SENDER }), 503);
    }

    const sent = await sendSignInLink(db, auth, {
      email,
      callbackURL: next,
      headers: request.headers,
    });
    if (sent === "send-failed") {
      return render(
        signInPage({
          next,
          error: "The sign-in link could not be sent. Try again, or tell an operator.",
        }),
        502,
      );
    }
    // Deliberately the same page whether or not that address is a Member. The
    // form is open to the internet and the Member list is not public, so an
    // answer that differed would turn sign-in into a membership oracle.
    return render(linkSentPage({ email }));
  }

  if (path === "/signin") {
    if (viewer) return redirect(safeNext(url.searchParams.get("next")) ?? "/");
    return render(signInPage({ next: safeNext(url.searchParams.get("next")) }));
  }

  // POST, not a link: signing out changes server state, and a GET that does
  // that is fetched by anything that prefetches links.
  if (path === "/signout" && request.method === "POST") {
    const out = await auth.api.signOut({ headers: request.headers, asResponse: true });
    const headers = new Headers();
    for (const cookie of out.headers.getSetCookie()) headers.append("set-cookie", cookie);
    headers.set("location", "/signin");
    return new Response(null, { status: 302, headers });
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
    return acceptInviteRequest(request, db, auth, {
      env,
      url,
      viewer,
      workspace,
      canSendEmail: Boolean(sendEmail),
    });
  }

  // ---- everything below is Members-only ------------------------------------

  if (!viewer) {
    return redirect(`${SESSION_REQUIRED}?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  try {
    if (path === "/") return render(await workstreamListPage(db));

    if (path === "/members") {
      const confirming = url.searchParams.get("confirm");
      return render(await membersPage(db, viewer, confirming ? { confirming } : {}));
    }
    if (path === "/members/remove" && request.method === "POST") {
      const form = await request.formData();
      const id = String(form.get("id") ?? "");
      // The id arrives from a form field, so the one rule that is not "any
      // Member may do this" has to be enforced here rather than by the absence
      // of a button: your own row is never removable.
      if (id === viewer.id) {
        return render(
          await membersPage(db, viewer, {
            error: "You cannot remove yourself. Sign out to leave this Workspace.",
          }),
          400,
        );
      }
      const target = (await listMembers(db)).find((m) => m.id === id);
      if (!target || !(await removeMember(db, { userId: id }))) {
        return render(
          await membersPage(db, viewer, { error: `No Member of this Workspace has id ${id}.` }),
          404,
        );
      }
      return render(await membersPage(db, viewer, { removed: target.name }));
    }
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
      // Scoped to the viewer: the id comes from a form field, so an unscoped
      // revoke would let any Member kill any other Member's token.
      const revoked = await revokeToken(db, { tokenId: id, userId: viewer.id });
      return render(
        await tokensPage(db, viewer, revoked ? { revoked: id } : { notYours: id }),
        revoked ? 200 : 404,
      );
    }

    for (const [pattern, load] of READ_ROUTES) {
      const match = pattern.exec(path);
      if (match) {
        const [, ...params] = match;
        return render(await load(db, ...params.map((p) => decodeURIComponent(p!))));
      }
    }
  } catch (err) {
    if (err instanceof PageNotFound) return notFoundPage(env, url, viewer);
    throw err;
  }

  return notFoundPage(env, url, viewer);
}

/**
 * Redeem an invite: make the address a Member, then mail it a sign-in link.
 *
 * There is no password to choose any more, so all this collects is the name to
 * attribute entries to. `acceptInvite` is conditional on the invite still being
 * pending, so if two people open the same link at once only one of them gets
 * past it.
 *
 * It ends at "check your email" rather than signing the visitor straight in.
 * That costs a click, and buys the property that a browser session is only ever
 * minted by a magic link — one path, tested once. The invite token proves the
 * link was received; the sign-in link proves the inbox is still theirs, which
 * is the thing a session should rest on.
 */
async function acceptInviteRequest(
  request: Request,
  db: CruxDb,
  auth: CruxAuth,
  ctx: {
    env: WebEnv;
    url: URL;
    viewer: Viewer | null;
    workspace: string;
    canSendEmail: boolean;
  },
): Promise<Response> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim();

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
  if (!ctx.canSendEmail) return fail(NO_EMAIL_SENDER, 503);

  // The row may already exist: a corpus migrated from the single-machine
  // database authors its rows against `users` rows nobody has signed in as, and
  // re-using one keeps that authorship attached to the person who earned it.
  const member = await ensureMember(db, { email: invite.email, name });

  if (!(await acceptInvite(db, { inviteId: invite.id, userId: member.userId }))) {
    return fail("This invite link was just used by someone else.", 409);
  }

  const sent = await sendSignInLink(db, auth, {
    email: invite.email,
    callbackURL: "/",
    headers: request.headers,
  });
  if (sent === "send-failed") {
    // The Member exists and the invite is spent, so this is recoverable from
    // the sign-in form — say so rather than implying the invite was wasted.
    return fail(
      "You are a Member now, but the sign-in link could not be sent. Try again from the sign-in page.",
      502,
    );
  }

  return htmlResponse(
    page({
      title: "Check your email",
      viewer: null,
      workspace: ctx.workspace,
      body: linkSentPage({ email: invite.email, joined: true }).body,
    }),
  );
}

/** Only same-origin paths survive, so `?next=` cannot bounce off this site. */
function safeNext(next: string | null): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}
