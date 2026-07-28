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

/** Sign James in by handing him an invite and redeeming it — the only route in. */
async function inviteAndJoin(
  email: string,
  name: string,
  password = "correct-horse-battery",
): Promise<{ cookie: string; userId: string }> {
  const { createInvite } = await import("@crux/core/auth/invites");
  const invite = await createInvite(db, { email, invitedById: "USR-james" });
  const res = await post("/invite/accept", { token: invite.token, name, password });
  expect(res.status).toBe(302);
  const cookie = cookieJar(res);
  const rows = await db.select().from(users);
  const created = rows.find((u) => u.email === email);
  expect(created, "redeeming an invite creates a row in users").toBeTruthy();
  return { cookie, userId: created!.id };
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
    expect(await res.text()).toContain("Problems by Stage");
  });

  test("an invite is single-use", async () => {
    const { createInvite } = await import("@crux/core/auth/invites");
    const invite = await createInvite(db, {
      email: "twice@example.com",
      invitedById: "USR-james",
    });
    const first = await post("/invite/accept", {
      token: invite.token,
      name: "First",
      password: "correct-horse-battery",
    });
    expect(first.status).toBe(302);

    const second = await post("/invite/accept", {
      token: invite.token,
      name: "Second",
      password: "correct-horse-battery",
    });
    expect(second.status).toBe(410);
  });

  test("an unknown invite token is refused", async () => {
    const res = await get("/invite?token=inv_nope");
    expect(res.status).toBe(410);
  });
});

describe("sign in", () => {
  test("the form navigates on success rather than rendering JSON", async () => {
    await inviteAndJoin("returning@example.com", "Returning Member");

    const res = await post("/signin", {
      email: "returning@example.com",
      password: "correct-horse-battery",
      next: "/w/crux",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/w/crux");

    // And the session it hands back actually opens the page it promised.
    const body = await (await get("/w/crux", { headers: { cookie: cookieJar(res) } })).text();
    expect(body).toContain("Problems by Stage");
  });

  test("a wrong password does not issue a session", async () => {
    await inviteAndJoin("wrong@example.com", "Wrong Password");
    const res = await post("/signin", { email: "wrong@example.com", password: "not-the-password" });
    expect(res.status).toBe(401);
    expect(cookieJar(res)).not.toContain("session_token");
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
