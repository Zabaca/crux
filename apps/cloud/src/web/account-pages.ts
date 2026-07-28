/**
 * The Workspace pages: signing in, redeeming an invite, and the Members and
 * CLI-token screens.
 *
 * The Members page is the whole of membership administration, and it is short
 * on purpose — there is no role to assign and no Workstream to grant, because
 * an invite grants the deployment (ADR-0003). The sign-in form posts to the
 * Worker rather than straight to Better Auth, which answers a form post with
 * JSON and a `Location` header that a browser renders instead of follows.
 */
import { eq } from "drizzle-orm";

import type { CruxDb } from "@crux/core/db";
import { apiTokens } from "@crux/core/db/schema";
import { authUsers } from "@crux/core/db/auth-schema";
import { listInvites } from "@crux/core/auth/invites";

import { html, isoDate as date, type Html } from "./html.js";
import type { Viewer } from "./layout.js";

/**
 * `/signin`. A plain form post — no client JavaScript is involved in
 * establishing a session. It posts to the Worker, which calls Better Auth and
 * turns the result into a real redirect (see `router.ts`).
 */
export function signInPage(opts: { next?: string; error?: string } = {}): {
  title: string;
  body: Html;
} {
  const body = html`
    <h1>Sign in</h1>
    <p class="sub">Members of this Workspace only. Invites are issued by an existing Member.</p>
    ${opts.error ? html`<div class="notice bad">${opts.error}</div>` : ""}
    <form class="form" method="post" action="/signin">
      <input type="hidden" name="next" value="${opts.next ?? "/"}" />
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required />
      <label for="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="current-password"
        required
      />
      <p><button class="btn" type="submit">Sign in</button></p>
      <p style="color:var(--faint);font-size:12px">
        Have an invite link? Open it to set your password.
      </p>
    </form>
  `;
  return { title: "Sign in", body };
}

/** `/invite?token=…` — the one place an account is created. */
export function invitePage(
  opts: { email?: string; token?: string; error?: string; invalid?: string } = {},
): { title: string; body: Html } {
  if (opts.invalid) {
    return {
      title: "Invite",
      body: html`<h1>Invite</h1>
        <div class="notice bad">${opts.invalid}</div>
        <p><a href="/signin">Back to sign in</a></p>`,
    };
  }
  const body = html`
    <h1>Join this Workspace</h1>
    <p class="sub">
      You were invited as <b>${opts.email}</b>. Membership grants the whole deployment — every
      Member sees every Workstream in it.
    </p>
    ${opts.error ? html`<div class="notice bad">${opts.error}</div>` : ""}
    <form class="form" method="post" action="/invite/accept">
      <input type="hidden" name="token" value="${opts.token ?? ""}" />
      <label for="name">Your name</label>
      <input id="name" name="name" type="text" autocomplete="name" required />
      <label for="password">Choose a password</label>
      <input
        id="password"
        name="password"
        type="password"
        autocomplete="new-password"
        minlength="10"
        required
      />
      <p><button class="btn" type="submit">Join</button></p>
      <p style="color:var(--faint);font-size:12px">At least 10 characters.</p>
    </form>
  `;
  return { title: "Join", body };
}

/** `/members` — who is in the Workspace, and who has been invited. */
export async function membersPage(
  db: CruxDb,
  viewer: Viewer,
  opts: { inviteLink?: string; invitedEmail?: string; error?: string } = {},
): Promise<{ title: string; body: Html }> {
  const members = await db
    .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
    .from(authUsers);
  const invites = (await listInvites(db)).filter((i) => !i.acceptedAt);
  const now = Date.now();

  const body = html`
    <h1>Members</h1>
    <p class="sub">
      Membership is coarse by design: it grants the whole Workspace, never a subset of Workstreams.
    </p>

    ${opts.error ? html`<div class="notice bad">${opts.error}</div>` : ""}
    ${
      opts.inviteLink
        ? html`<div class="notice">
            Invite created for <b>${opts.invitedEmail}</b>. Send them this link — it is shown once
            and works for seven days.
            <p class="mono" style="margin:8px 0 0"><code>${opts.inviteLink}</code></p>
          </div>`
        : ""
    }

    <div class="panel">
      <div class="hd">In this Workspace <span class="r">${members.length}</span></div>
      ${members.map(
        (m) => html`<div class="sol" style="grid-template-columns:1fr auto">
          <div class="t">
            ${m.name} ${m.id === viewer.id ? html`<span class="badge chosen">you</span>` : ""}
          </div>
          <div style="color:var(--faint);font-size:12px">${m.email ?? "no address"}</div>
        </div>`,
      )}
    </div>

    <h2>Invite a Member</h2>
    <form class="form" method="post" action="/members/invite" style="max-width:520px">
      <div class="row-inline">
        <input name="email" type="email" placeholder="name@example.com" required style="flex:1" />
        <button class="btn" type="submit">Send invite</button>
      </div>
    </form>

    <h2>Pending invites</h2>
    ${
      invites.length === 0
        ? html`<div class="empty">No invites are outstanding.</div>`
        : html`<div class="panel">
            ${invites.map(
              (i) => html`<div class="sol" style="grid-template-columns:1fr auto">
                <div class="t">${i.email}</div>
                <div style="color:var(--faint);font-size:12px">
                  ${i.expiresAt <= now ? "expired" : `expires ${date(i.expiresAt)}`}
                </div>
              </div>`,
            )}
          </div>`
    }
  `;
  return { title: "Members", body };
}

/** `/tokens` — mint and revoke the bearer tokens the CLI presents. */
export async function tokensPage(
  db: CruxDb,
  viewer: Viewer,
  opts: { minted?: string; revoked?: string; notYours?: string } = {},
): Promise<{ title: string; body: Html }> {
  const rows = await db.select().from(apiTokens).where(eq(apiTokens.userId, viewer.id));
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);

  const body = html`
    <h1>CLI tokens</h1>
    <p class="sub">
      A token authenticates <span class="mono">crux</span> against this deployment as you. Only its
      hash is stored, so a leaked corpus yields no usable tokens.
    </p>

    ${
      opts.minted
        ? html`<div class="notice">
            Your new token — copy it now, it is not shown again.
            <p class="mono" style="margin:8px 0 0"><code>${opts.minted}</code></p>
            <p style="margin:8px 0 0;color:var(--faint);font-size:12px">
              <span class="mono"
                >crux init --url ${""}&lt;this deployment&gt; --token &lt;token&gt;</span
              >
            </p>
          </div>`
        : ""
    }
    ${
      opts.revoked
        ? html`<div class="notice">
            <span class="mono">${opts.revoked}</span> is revoked. It will not authenticate again.
          </div>`
        : ""
    }
    ${
      opts.notYours
        ? html`<div class="notice bad">
            No token of yours has id <span class="mono">${opts.notYours}</span>. A Member can only
            revoke their own tokens.
          </div>`
        : ""
    }

    <div class="panel">
      <div class="hd">Your tokens <span class="r">${sorted.length}</span></div>
      ${
        sorted.length === 0
          ? html`<div class="pad" style="color:var(--faint)">No tokens yet.</div>`
          : sorted.map(
              (t) => html`<div class="sol" style="grid-template-columns:110px 1fr auto">
                <div>
                  ${
                    t.revokedAt
                      ? html`<span class="badge rejected">revoked</span>`
                      : html`<span class="badge chosen">active</span>`
                  }
                </div>
                <div class="t">
                  <span class="mono">${t.id}</span>
                  ${t.name ? html`<span style="color:var(--faint)"> · ${t.name}</span>` : ""}
                  <div style="color:var(--faint);font-size:12px">created ${date(t.createdAt)}</div>
                </div>
                <div>
                  ${
                    t.revokedAt
                      ? ""
                      : html`<form method="post" action="/tokens/revoke">
                          <input type="hidden" name="id" value="${t.id}" />
                          <button class="btn danger" type="submit">Revoke</button>
                        </form>`
                  }
                </div>
              </div>`,
            )
      }
    </div>

    <h2>Mint a token</h2>
    <form class="form" method="post" action="/tokens/mint" style="max-width:520px">
      <div class="row-inline">
        <input name="name" type="text" placeholder="laptop" style="flex:1" />
        <button class="btn" type="submit">Mint</button>
      </div>
    </form>
  `;
  return { title: "CLI tokens", body };
}
