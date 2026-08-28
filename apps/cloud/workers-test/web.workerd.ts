import { env, SELF, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "@crux/core/db";
import { applyD1Schema } from "@crux/core/db/d1";
import { observations, problems, solutions, users, workstreams } from "@crux/core/db/schema";
import { dispatch } from "@crux/core/actions";

// Seam: the deployed request path, same as api.workerd.ts. The browser surfaces
// — sign-in, invite, the read pages, Members and CLI tokens — are all HTTP on
// this Worker, so `SELF.fetch` is the interface they are tested through. No page
// module is imported and poked directly.

let db: CruxDb;

const BASE = "https://crux.example";

/** Fetch without following redirects, so a session gate is observable. */
function get(path: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${path}`, { redirect: "manual", ...init });
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  await db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
  await db.insert(workstreams).values({ id: "WS-crux", slug: "crux", title: "Crux" });
});

/** Collect cookies from a response into a `cookie` header for the next request. */
function cookieJar(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

/** Post a form the way a browser would. */
function post(path: string, fields: Record<string, string>, cookie?: string): Promise<Response> {
  const body = new URLSearchParams(fields);
  return SELF.fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

/**
 * Make `email` a Member the way the product does — an invite, redeemed over
 * HTTP — and then hand back a session for them.
 *
 * The session is minted through the magic-link endpoints directly rather than
 * by reading the mail the Worker sent, because the sent mail leaves the isolate
 * and the token is stored hashed, so there is nothing to read it back out of.
 * That the link in a real mail mints a session for the right row is covered
 * where the sender is injectable: `packages/core/workers-test/membership.workerd.ts`.
 */
async function inviteAndJoin(
  email: string,
  name: string,
): Promise<{
  cookie: string;
  userId: string;
}> {
  const { createInvite } = await import("@crux/core/auth/invites");
  const invite = await createInvite(db, { email, invitedById: "USR-james" });
  const res = await post("/invite/accept", { token: invite.token, name });
  expect(res.status, "redeeming an invite ends at 'check your email'").toBe(200);
  const rows = await db.select().from(users);
  const created = rows.find((u) => u.email === email);
  expect(created, "redeeming an invite creates a row in users").toBeTruthy();
  return { cookie: await sessionCookieFor(email), userId: created!.id };
}

/** A session cookie for a Member, as clicking their sign-in link would produce. */
async function sessionCookieFor(email: string): Promise<string> {
  const { createAuth } = await import("@crux/core/auth/better-auth");
  let link: string | undefined;
  const auth = createAuth(db, {
    secret: "test-secret-not-used-in-production",
    baseURL: BASE,
    sendEmail: async (message) => {
      link = message.text.match(/https?:\/\/\S+/)?.[0];
    },
  });
  await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
  expect(link, "signing in mails a link").toBeDefined();
  const verified = await auth.api.magicLinkVerify({
    query: { token: new URL(link!).searchParams.get("token")! },
    headers: new Headers(),
    asResponse: true,
  });
  return cookieJar(verified);
}

/**
 * Write to the corpus the way the CLI does, so the pages are read against rows
 * the transition layer produced rather than hand-inserted ones.
 */
async function dispatchAs(userId: string, action: unknown): Promise<any> {
  const store = {
    read: async () => null,
    write: async () => {},
  };
  return dispatch(action, { db, viewStore: store as never, actor: { id: userId } });
}

/** A Problem narrowed all the way to a Decision — the shape the pages render. */
async function seedNarrowedProblem(): Promise<number> {
  const p = await dispatchAs("USR-james", {
    kind: "ADD_PROBLEM",
    payload: {
      workstream: "WS-crux",
      title: "Context evaporates between sessions",
      description: "Each new conversation restarts cold.",
    },
  });
  const problemId = (p as { result: { id: number } }).result.id;

  const o = await dispatchAs("USR-james", {
    kind: "ADD_OBSERVATION",
    payload: {
      workstream: "WS-crux",
      content: "Spent 25 minutes re-explaining a decision I made on Tuesday.",
      source: "session log",
    },
  });
  const observationId = (o as { result: { id: string } }).result.id;

  await dispatchAs("USR-james", {
    kind: "ADD_EVIDENCE",
    payload: { problem: problemId, observation: observationId, note: "the cost being paid" },
  });

  const s = await dispatchAs("USR-james", {
    kind: "ADD_SOLUTION",
    payload: { problem: problemId, title: "Structured residue layer" },
  });
  const solutionId = (s as { result: { id: number } }).result.id;

  await dispatchAs("USR-james", {
    kind: "ADD_DECISION",
    payload: {
      problem: problemId,
      chosen: solutionId,
      rationale: "Chosen because it reloads as structure rather than prose.",
    },
  });
  return problemId;
}

describe("session gate", () => {
  test("a read page with no session redirects to sign-in", async () => {
    const res = await get("/w/crux");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fw%2Fcrux");
  });
});

describe("invite", () => {
  test("a Member who redeems an invite becomes a row in the existing users table", async () => {
    const { cookie, userId } = await inviteAndJoin("dana@example.com", "Dana Reyes");
    expect(userId.startsWith("USR-")).toBe(true);

    const res = await get("/w/crux", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Stage is a Problem\u2019s place on the roadmap");
  });

  test("an invite is single-use", async () => {
    const { createInvite } = await import("@crux/core/auth/invites");
    const invite = await createInvite(db, {
      email: "twice@example.com",
      invitedById: "USR-james",
    });
    const first = await post("/invite/accept", { token: invite.token, name: "First" });
    expect(first.status).toBe(200);

    const second = await post("/invite/accept", { token: invite.token, name: "Second" });
    expect(second.status).toBe(410);
  });

  test("an unknown invite token is refused", async () => {
    const res = await get("/invite?token=inv_nope");
    expect(res.status).toBe(410);
  });
});

describe("sign in", () => {
  test("asking for a link never issues a session by itself", async () => {
    await inviteAndJoin("returning@example.com", "Returning Member");

    const res = await post("/signin", { email: "returning@example.com", next: "/w/crux" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your email");
    // The form is a request for a mail, not a credential check. Anything else
    // here would mean the page in front of the inbox could open the corpus.
    expect(cookieJar(res)).not.toContain("session_token");
  });

  test("a non-Member gets the same page as a Member, and no row is created", async () => {
    const member = await post("/signin", { email: "returning@example.com" });
    const stranger = await post("/signin", { email: "stranger@example.com" });

    // Byte-for-byte the same answer: the sign-in form is public, so a reply
    // that varied would tell anyone who asked who is in this Workspace.
    expect(stranger.status).toBe(member.status);
    expect(await stranger.text()).toContain("Check your email");
    expect(cookieJar(stranger)).not.toContain("session_token");

    const rows = await db.select().from(users);
    expect(rows.some((u) => u.email === "stranger@example.com")).toBe(false);
  });

  test("signing out ends the session, and only a POST does it", async () => {
    const { cookie } = await inviteAndJoin("bye@example.com", "Leaving Member");
    expect((await get("/w/crux", { headers: { cookie } })).status).toBe(200);

    // A GET must not end a session — anything that prefetches links would.
    const viaGet = await get("/signout", { headers: { cookie } });
    expect(viaGet.status).toBe(404);
    expect((await get("/w/crux", { headers: { cookie } })).status).toBe(200);

    const out = await post("/signout", {}, cookie);
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("/signin");

    const after = await get("/w/crux", { headers: { cookie: cookieJar(out) || cookie } });
    expect(after.status).toBe(302);
  });

  test("`next` cannot bounce a Member off this deployment", async () => {
    const { cookie } = await inviteAndJoin("open@example.com", "Open Redirect");
    const res = await get("/signin?next=https://evil.example/steal", { headers: { cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("CLI tokens", () => {
  test("a minted token authenticates the API, and a revoked one stops", async () => {
    const { cookie } = await inviteAndJoin("tok@example.com", "Token Holder");

    const minted = await post("/tokens/mint", { name: "laptop" }, cookie);
    expect(minted.status).toBe(200);
    const page = await minted.text();
    // The plaintext token is shown exactly once, at mint time.
    const token = /crux_[0-9a-f]{64}/.exec(page)?.[0];
    expect(token, "the minted token is displayed").toBeTruthy();

    const useIt = () =>
      SELF.fetch(`${BASE}/v1/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "WORKSTREAM_LIST" }),
      });

    expect((await useIt()).status).toBe(200);

    const tokenId = /TOK-[0-9a-f]{16}/.exec(page)?.[0];
    expect(tokenId).toBeTruthy();
    const revoked = await post("/tokens/revoke", { id: tokenId! }, cookie);
    expect(revoked.status).toBe(200);

    expect((await useIt()).status).toBe(401);
  });

  test("a Member cannot revoke another Member's token", async () => {
    const owner = await inviteAndJoin("owner@example.com", "Token Owner");
    const ownerPage = await (await post("/tokens/mint", { name: "owner" }, owner.cookie)).text();
    const ownerToken = /crux_[0-9a-f]{64}/.exec(ownerPage)![0];
    const ownerTokenId = /TOK-[0-9a-f]{16}/.exec(ownerPage)![0];

    const attacker = await inviteAndJoin("attacker@example.com", "Other Member");
    const attempt = await post("/tokens/revoke", { id: ownerTokenId }, attacker.cookie);
    expect(attempt.status).toBe(404);

    // The owner's token still works — the id in the form is not authority.
    const res = await SELF.fetch(`${BASE}/v1/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "WORKSTREAM_LIST" }),
    });
    expect(res.status).toBe(200);
  });

  test("a session and a bearer token resolve to the same users row", async () => {
    const { cookie, userId } = await inviteAndJoin("same@example.com", "Same Person");
    const page = await (await post("/tokens/mint", { name: "cli" }, cookie)).text();
    const token = /crux_[0-9a-f]{64}/.exec(page)![0];

    // The API attributes writes to the token's user; the browser attributes the
    // page to the session's user. Both must be the one row.
    const res = await SELF.fetch(`${BASE}/v1/dispatch`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "ADD_PROBLEM",
        payload: { workstream: "WS-crux", title: "From the CLI", description: "d" },
      }),
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(problems);
    expect(rows[0]!.createdById).toBe(userId);
  });
});

describe("removing a Member", () => {
  test("a removed Member leaves the list, and what they filed still names them", async () => {
    const remover = await inviteAndJoin("stays@example.com", "Staying Member");
    const leaver = await inviteAndJoin("goes@example.com", "Departing Member");

    const filed = await dispatchAs(leaver.userId, {
      kind: "ADD_PROBLEM",
      payload: { workstream: "WS-crux", title: "Filed before leaving", description: "d" },
    });
    const problemId = (filed as { result: { id: number } }).result.id;

    const before = await (await get("/members", { headers: { cookie: remover.cookie } })).text();
    expect(before).toContain("Departing Member");

    const removed = await post("/members/remove", { id: leaver.userId }, remover.cookie);
    expect(removed.status).toBe(200);

    const after = await (await get("/members", { headers: { cookie: remover.cookie } })).text();
    expect(after).not.toContain("Departing Member");

    // Attribution is the product: the row survives the removal precisely so the
    // Problem it authored still points at a person, not at a hole.
    const read = await SELF.fetch(`${BASE}/v1/query`, {
      method: "POST",
      headers: { cookie: remover.cookie, origin: BASE, "content-type": "application/json" },
      body: JSON.stringify({ kind: "PROBLEM_GET", id: problemId }),
    });
    expect(read.status).toBe(200);
    const { result } = await read.json<{ result: { createdById: string } }>();
    expect(result.createdById).toBe(leaver.userId);
  });

  test("a removed Member's live session and CLI token both stop working", async () => {
    const remover = await inviteAndJoin("admin@example.com", "Admin Member");
    const leaver = await inviteAndJoin("out@example.com", "On The Way Out");

    const minted = await (await post("/tokens/mint", { name: "cli" }, leaver.cookie)).text();
    const token = /crux_[0-9a-f]{64}/.exec(minted)![0];
    const useToken = () =>
      SELF.fetch(`${BASE}/v1/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ kind: "WORKSTREAM_LIST" }),
      });

    // Both doors open before the removal, and both renderers with them: `/` is
    // the hand-written entry's own page, `/w/<slug>` is Astro's. They resolve
    // the session through different functions, so a gate added to one and not
    // the other would leave half the site readable.
    expect((await get("/", { headers: { cookie: leaver.cookie } })).status).toBe(200);
    expect((await get("/w/crux", { headers: { cookie: leaver.cookie } })).status).toBe(200);
    expect((await useToken()).status).toBe(200);

    expect((await post("/members/remove", { id: leaver.userId }, remover.cookie)).status).toBe(200);

    // The session cookie is still in their browser and the token is still in
    // their config; neither is a way in any more.
    const handWritten = await get("/", { headers: { cookie: leaver.cookie } });
    expect(handWritten.status).toBe(302);
    expect(handWritten.headers.get("location")).toContain("/signin");

    const astroPage = await get("/w/crux", { headers: { cookie: leaver.cookie } });
    expect(astroPage.status).toBe(302);
    expect(astroPage.headers.get("location")).toContain("/signin");

    expect((await useToken()).status).toBe(401);
  });

  test("removal takes two steps: the plain page only arms, the armed row posts", async () => {
    const remover = await inviteAndJoin("two@example.com", "Two Step");
    const other = await inviteAndJoin("other@example.com", "Other Member");

    const plain = await (await get("/members", { headers: { cookie: remover.cookie } })).text();
    expect(plain).toContain(`/members?confirm=${other.userId}`);
    // Nothing on the resting page can be POSTed to the removal route: the first
    // click arms a row, it does not remove anybody.
    expect(plain).not.toContain('action="/members/remove"');

    const armed = await (
      await get(`/members?confirm=${other.userId}`, { headers: { cookie: remover.cookie } })
    ).text();
    expect(armed).toContain("Confirm");
    // Exactly one row is armed — the one named — and it is the only one that
    // carries the form.
    expect(armed.split('action="/members/remove"').length - 1).toBe(1);
    expect(armed).toContain(`value="${other.userId}"`);
  });

  test("a Member cannot remove themselves — the last way in is not a button", async () => {
    const solo = await inviteAndJoin("solo@example.com", "Solo Member");

    const page = await (await get("/members", { headers: { cookie: solo.cookie } })).text();
    expect(page).toContain("sign out to leave");
    expect(page).not.toContain(`confirm=${solo.userId}`);

    // And not merely un-offered: the id travels in a form field, so the rule is
    // enforced where the request lands, not by the absence of a control.
    const res = await post("/members/remove", { id: solo.userId }, solo.cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("cannot remove yourself");

    expect((await get("/w/crux", { headers: { cookie: solo.cookie } })).status).toBe(200);
  });
});

describe("read pages", () => {
  test("every Member sees every Workstream in the deployment", async () => {
    await db.insert(workstreams).values({ id: "WS-other", slug: "other", title: "Someone Else" });
    const { cookie } = await inviteAndJoin("newcomer@example.com", "Newcomer");

    const body = await (await get("/", { headers: { cookie } })).text();
    // A Member invited after both Workstreams existed still sees both: coarse
    // membership grants the deployment, never a subset (ADR-0003).
    expect(body).toContain("Someone Else");
    expect(body).toContain("Crux");
  });

  test("a Problem URL resolves to the Problem, its Evidence and its Decision", async () => {
    const { cookie } = await inviteAndJoin("reader@example.com", "Reader");

    const problemId = await seedNarrowedProblem();

    const res = await get(`/w/crux/problems/${problemId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Context evaporates");
    expect(body).toContain("re-explaining a decision"); // the Observation, inlined
    expect(body).toContain("because it reloads as structure"); // the Decision rationale
    expect(body).toContain(`/w/crux/solutions/`); // linked, not just listed
  });

  test("a Solution URL shows its Problem and the Decision that chose it", async () => {
    const { cookie } = await inviteAndJoin("sol@example.com", "Sol Reader");
    await seedNarrowedProblem();
    const solutionId = (await db.select().from(solutions))[0]!.id;

    const body = await (
      await get(`/w/crux/solutions/${solutionId}`, { headers: { cookie } })
    ).text();
    expect(body).toContain("Structured residue");
    expect(body).toContain("Context evaporates");
    expect(body).toContain("because it reloads as structure");
  });

  test("an Observation URL shows every Problem it supports as Evidence", async () => {
    const { cookie } = await inviteAndJoin("obs@example.com", "Obs Reader");
    await seedNarrowedProblem();
    const observationId = (await db.select().from(observations))[0]!.id;

    const body = await (
      await get(`/w/crux/observations/${observationId}`, { headers: { cookie } })
    ).text();
    expect(body).toContain("re-explaining a decision");
    expect(body).toContain("Context evaporates");
    expect(body).toContain("the cost being paid"); // the why-note
  });

  test("the Observation list groups the pile by what has been done with it", async () => {
    const { cookie } = await inviteAndJoin("obslist@example.com", "Obs Lister");
    await seedNarrowedProblem(); // files one Observation and links it as Evidence

    await dispatchAs("USR-james", {
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "nobody has looked at this one yet" },
    });
    const dupe = await dispatchAs("USR-james", {
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "a signal we decided not to use" },
    });
    await dispatchAs("USR-james", {
      kind: "ARCHIVE_OBSERVATION",
      payload: { id: (dupe as { result: { id: string } }).result.id, rationale: "duplicate" },
    });

    const body = await (await get("/w/crux/observations", { headers: { cookie } })).text();
    expect(body).toContain("3 filed");
    expect(body).toContain("1 linked to a Problem");
    expect(body).toContain("1 archived");
    expect(body).toContain("1 waiting");
    // Each one is present and says what became of it.
    expect(body).toContain("nobody has looked at this one yet");
    expect(body).toContain("Evidence for 1 Problem");
    expect(body).toContain("duplicate");
  });

  test("the Workstream page says how much intake is waiting", async () => {
    const { cookie } = await inviteAndJoin("waiting@example.com", "Waiting");
    await dispatchAs("USR-james", {
      kind: "ADD_OBSERVATION",
      payload: { workstream: "WS-crux", content: "untriaged" },
    });
    const body = await (await get("/w/crux", { headers: { cookie } })).text();
    expect(body).toContain("/w/crux/observations");
    expect(body).toContain("1 waiting");
  });

  test("a URL naming nothing is a 404 page, not a crash", async () => {
    const { cookie } = await inviteAndJoin("missing@example.com", "Missing");
    const res = await get("/w/crux/problems/9999", { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Not found");
  });

  test("corpus text is escaped, not interpolated as markup", async () => {
    const { cookie } = await inviteAndJoin("xss@example.com", "Careful");
    await dispatchAs("USR-james", {
      kind: "ADD_PROBLEM",
      payload: {
        workstream: "WS-crux",
        title: "<script>alert(1)</script>",
        description: "d",
      },
    });
    const body = await (await get("/w/crux", { headers: { cookie } })).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });
});

describe("docs", () => {
  test("/docs is README, rendered", async () => {
    const { cookie } = await inviteAndJoin("docs@example.com", "Docs Reader");
    const res = await get("/docs", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    // README's own opening line, and a sentence only it carries.
    expect(body).toContain("Structured residue for product discovery");
  });

  test("an internal link navigates in-UI rather than off to the file", async () => {
    const { cookie } = await inviteAndJoin("links@example.com", "Link Reader");
    const body = await (await get("/docs", { headers: { cookie } })).text();
    // README links CONTEXT.md; in the rendered tree that is a /docs URL.
    expect(body).toContain('href="/docs/CONTEXT.md"');
    // …and an external link is left alone.
    expect(body).toContain("https://bun.sh/install");
  });

  test("a linked doc renders at its own URL", async () => {
    const { cookie } = await inviteAndJoin("adr@example.com", "ADR Reader");
    const res = await get("/docs/docs/adr/0002-readme-rooted-doc-tree.md", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("README-rooted doc tree");
  });

  test("an @import renders inline, so the page shows what an agent loads", async () => {
    const { cookie } = await inviteAndJoin("import@example.com", "Import Reader");
    const body = await (await get("/docs", { headers: { cookie } })).text();
    // README @imports the karpathy guidelines; its text is on the page.
    expect(body).toContain("Minimum code that solves the problem");
  });

  test("a doc outside the tree is a 404, not a file read", async () => {
    const { cookie } = await inviteAndJoin("nodoc@example.com", "No Doc");
    const res = await get("/docs/package.json", { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  test("docs need a session, like every other page", async () => {
    const res = await get("/docs");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/signin?next=%2Fdocs");
  });
});

describe("the roadmap board", () => {
  /** POST an action the way the board island does: session cookie, same origin. */
  function dispatchFromBrowser(action: unknown, cookie: string, origin = BASE): Promise<Response> {
    return SELF.fetch(`${BASE}/v1/dispatch`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify(action),
    });
  }

  test("the board renders the Problems it can move", async () => {
    const { cookie } = await inviteAndJoin("board@example.com", "Board Reader");
    await seedNarrowedProblem();
    const res = await get("/w/crux", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Context evaporates");
    // The island is on the page, hydrating rather than server-only markup.
    expect(body).toContain("astro-island");
  });

  test("dragging a Problem to a Stage persists through the API", async () => {
    const { cookie } = await inviteAndJoin("drag@example.com", "Dragger");
    const problemId = await seedNarrowedProblem();

    const res = await dispatchFromBrowser(
      { kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } },
      cookie,
    );
    expect(res.status).toBe(200);

    // Observed through the page, not the database: the Problem is in `now`.
    const board = await (await get("/w/crux", { headers: { cookie } })).text();
    const nowLane = board.slice(
      board.indexOf('class="lane now"'),
      board.indexOf('class="lane next"'),
    );
    expect(nowLane).toContain("Context evaporates");
  });

  test("a server-rejected transition answers with its code and message", async () => {
    const { cookie } = await inviteAndJoin("reject@example.com", "Rejected");
    const problemId = await seedNarrowedProblem();
    await dispatchFromBrowser(
      { kind: "ABANDON_PROBLEM", payload: { id: problemId, rationale: "not worth it" } },
      cookie,
    );

    const res = await dispatchFromBrowser(
      { kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } },
      cookie,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ILLEGAL_TRANSITION");
    expect(body.error.message).toContain("terminal");
  });

  test("a cookie-authenticated write from another origin is refused", async () => {
    const { cookie } = await inviteAndJoin("csrf@example.com", "Elsewhere");
    const problemId = await seedNarrowedProblem();
    const res = await dispatchFromBrowser(
      { kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "now" } },
      cookie,
      "https://evil.example",
    );
    expect(res.status).toBe(401);
  });

  test("the board needs a session, like every other page", async () => {
    const res = await get("/w/crux");
    expect(res.status).toBe(302);
  });

  test("a Problem in a terminal Stage is shown, and is not draggable", async () => {
    const { cookie } = await inviteAndJoin("terminal@example.com", "Terminal");
    const problemId = await seedNarrowedProblem();
    await dispatchAs("USR-james", {
      kind: "ABANDON_PROBLEM",
      payload: { id: problemId, rationale: "the cost turned out to be someone else's" },
    });

    const body = await (await get("/w/crux", { headers: { cookie } })).text();
    // The lane renders — "how much was abandoned" is a fact a roadmap is read
    // for, and it is the half the old board dropped.
    expect(body).toContain('<div class="lane abandoned">');
    expect(body).toContain("Context evaporates");
    // …and the card in it is inert: `abandoned` is left by a transition of its
    // own, never by a drag, so dnd-kit is told so rather than the server having
    // to refuse the move.
    const card = body.slice(body.indexOf('<div class="lane abandoned">'));
    expect(card).toContain('aria-disabled="true"');
  });

  test("the old board URL redirects to the page that absorbed it", async () => {
    const res = await get("/w/crux/board");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/w/crux");
  });
});

describe("live refresh", () => {
  test("a write in one session pushes to a stream open in another", async () => {
    const { cookie } = await inviteAndJoin("live@example.com", "Live");
    const problemId = await seedNarrowedProblem();

    // Session A: the board, subscribed to this Member's view-state stream.
    const stream = await SELF.fetch(`${BASE}/v1/view/stream`, { headers: { cookie } });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader();
    expect((await reader.read()).value).toContain(": connected");

    // Session B: the same Member, moving a Problem.
    const wrote = await SELF.fetch(`${BASE}/v1/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: BASE },
      body: JSON.stringify({ kind: "SCHEDULE_PROBLEM", payload: { id: problemId, stage: "next" } }),
    });
    expect(wrote.status).toBe(200);

    // Session A hears about it without asking.
    const pushed = (await reader.read()).value ?? "";
    expect(pushed).toContain("event: view");
    await reader.cancel();
  });
});

describe("contextual page actions", () => {
  function browserDispatch(action: unknown, cookie: string): Promise<Response> {
    return SELF.fetch(`${BASE}/v1/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: BASE },
      body: JSON.stringify(action),
    });
  }

  test("the Problem page offers the actions that belong to a Problem", async () => {
    const { cookie } = await inviteAndJoin("acts@example.com", "Actor");
    const problemId = await seedNarrowedProblem();
    const body = await (await get(`/w/crux/problems/${problemId}`, { headers: { cookie } })).text();
    expect(body).toContain("astro-island");
    expect(body).toContain("ADD_SOLUTION");
    expect(body).toContain("ADD_DECISION");
    // …and not the ones that belong to a Workstream.
    expect(body).not.toContain("ADD_WORKSTREAM");
  });

  test("filing an entity from the browser puts it on the page", async () => {
    const { cookie } = await inviteAndJoin("file@example.com", "Filer");
    const problemId = await seedNarrowedProblem();

    const res = await browserDispatch(
      {
        kind: "ADD_SOLUTION",
        payload: { problem: problemId, title: "Reload as structure, not prose" },
      },
      cookie,
    );
    expect(res.status).toBe(200);

    const body = await (await get(`/w/crux/problems/${problemId}`, { headers: { cookie } })).text();
    expect(body).toContain("Reload as structure, not prose");
  });

  test("an invariant refuses the transition and says which one", async () => {
    const { cookie } = await inviteAndJoin("inv@example.com", "Invariant");
    const problemId = await seedNarrowedProblem();

    // The chosen Solution has not shipped, so the Problem cannot be done.
    const res = await browserDispatch(
      { kind: "MARK_PROBLEM_DONE", payload: { id: problemId } },
      cookie,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVARIANT_VIOLATION");
    expect(body.error.message).toContain("no shipped Solution");
  });

  test("the Workstream board offers the actions that belong to a Workstream", async () => {
    const { cookie } = await inviteAndJoin("wsacts@example.com", "WS Actor");
    const body = await (await get("/w/crux", { headers: { cookie } })).text();
    expect(body).toContain("ADD_PROBLEM");
    expect(body).toContain("ADD_OBSERVATION");
  });
});
