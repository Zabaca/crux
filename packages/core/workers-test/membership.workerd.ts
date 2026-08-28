/**
 * Membership and the magic link, against a real D1 inside workerd — Better
 * Auth's adapter and its verification storage are what actually run there
 * (ADR-0006), and neither is exercised by a mock.
 *
 * The cases that matter are the two the design rests on: a migrated `users` row
 * signs in *as itself* rather than as a second identity, and an address with no
 * row is never mailed a link at all.
 */
import { env, reset } from "cloudflare:test";
import { describe, test, expect, beforeEach } from "vitest";
import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { users, problems, workstreams } from "../src/db/schema.js";
import { createAuth, type CruxAuth } from "../src/auth/better-auth.js";
import { ensureMember, findMemberByEmail, removeMember } from "../src/auth/membership.js";
import type { EmailMessage } from "../src/auth/email.js";

let db: CruxDb;
let auth: CruxAuth;
let sent: EmailMessage[];

/** Mail a sign-in link the way the router does: only to an existing Member. */
async function requestLink(email: string): Promise<"sent" | "not-a-member"> {
  if (!(await findMemberByEmail(db, email))) return "not-a-member";
  await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
  return "sent";
}

/** The `token` query parameter out of the most recently sent link. */
function tokenFromLastEmail(): string {
  const url = sent.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
  expect(url).toBeDefined();
  return new URL(url!).searchParams.get("token")!;
}

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  sent = [];
  auth = createAuth(db, {
    secret: "s".repeat(40),
    baseURL: "http://localhost",
    workspace: "Test Workspace",
    sendEmail: async (message) => {
      sent.push(message);
    },
  });
  await db.insert(users).values({
    id: "USR-james",
    slug: "james",
    name: "James",
    email: "james@zabaca.com",
  });
});

describe("signing in with a magic link", () => {
  test("mails a link to a Member and the link mints a session for that row", async () => {
    expect(await requestLink("james@zabaca.com")).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("james@zabaca.com");
    expect(sent[0]?.subject).toContain("Test Workspace");

    const verified = await auth.api.magicLinkVerify({
      query: { token: tokenFromLastEmail() },
      headers: new Headers(),
      asResponse: true,
    });
    // A verified link redirects to the callback and carries the session cookie.
    expect(verified.headers.getSetCookie().join(";")).toContain("session_token");

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: verified.headers.getSetCookie().join("; ") }),
    });
    expect(session?.user.id).toBe("USR-james");
  });

  test("sends nothing at all to an address with no users row", async () => {
    expect(await requestLink("stranger@example.com")).toBe("not-a-member");
    expect(sent).toHaveLength(0);
    // And no row was conjured on the way past.
    expect(await db.select().from(users)).toHaveLength(1);
  });

  test("a link is spent by the first use", async () => {
    await requestLink("james@zabaca.com");
    const token = tokenFromLastEmail();

    const first = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    });
    expect(first.headers.getSetCookie().join(";")).toContain("session_token");

    const second = await auth.api.magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    });
    expect(second.headers.getSetCookie().join(";")).not.toContain("session_token");
  });

  test("what lands in the database is not a usable link", async () => {
    await requestLink("james@zabaca.com");
    const token = tokenFromLastEmail();
    const stored = await env.DB.prepare("SELECT value, identifier FROM auth_verifications").all();
    const serialized = JSON.stringify(stored.results);
    expect(serialized).not.toContain(token);
  });
});

describe("removal", () => {
  test("a removed Member is never mailed a link again", async () => {
    expect(await requestLink("james@zabaca.com")).toBe("sent");
    expect(sent).toHaveLength(1);

    expect(await removeMember(db, { userId: "USR-james" })).toBe(true);

    // Not "the link is refused after the click" — nothing is sent at all, which
    // is the same gate a never-invited address meets.
    expect(await requestLink("james@zabaca.com")).toBe("not-a-member");
    expect(sent).toHaveLength(1);
  });

  test("re-inviting a removed address reinstates that row, not a second identity", async () => {
    await db.insert(workstreams).values({ id: "WS-x", slug: "x", title: "X" });
    await db.insert(problems).values({
      workstreamId: "WS-x",
      title: "filed before they left",
      description: "d",
      createdById: "USR-james",
    });

    await removeMember(db, { userId: "USR-james" });
    expect(await requestLink("james@zabaca.com")).toBe("not-a-member");

    // The way back in is the same door as the way in: an invite, redeemed.
    const outcome = await ensureMember(db, { email: "james@zabaca.com", name: "James" });
    expect(outcome).toEqual({ userId: "USR-james", created: false });

    expect(await requestLink("james@zabaca.com")).toBe("sent");
    // One row, and the Problem still points at it. A second identity here would
    // strand everything the first one authored.
    expect(await db.select().from(users)).toHaveLength(1);
    expect((await db.select().from(problems))[0]?.createdById).toBe("USR-james");
  });

  test("removing twice is a no-op, not a second removal", async () => {
    expect(await removeMember(db, { userId: "USR-james" })).toBe(true);
    expect(await removeMember(db, { userId: "USR-james" })).toBe(false);
    expect(await removeMember(db, { userId: "USR-nobody" })).toBe(false);
  });
});

describe("joining", () => {
  test("re-uses a migrated row, keeping its authorship", async () => {
    await db.insert(workstreams).values({ id: "WS-x", slug: "x", title: "X" });
    await db.insert(problems).values({
      workstreamId: "WS-x",
      title: "something worth solving",
      description: "filed before the corpus moved to the cloud",
      createdById: "USR-james",
    });

    const outcome = await ensureMember(db, {
      email: "james@zabaca.com",
      name: "James Someone-Else",
    });
    expect(outcome).toEqual({ userId: "USR-james", created: false });

    // One identity, and the Problem still points at it.
    expect(await db.select().from(users)).toHaveLength(1);
    const authored = await db.select().from(problems);
    expect(authored[0]?.createdById).toBe("USR-james");
  });

  test("creates a row for a new address, which can then be mailed a link", async () => {
    expect(await requestLink("newcomer@zabaca.com")).toBe("not-a-member");

    const outcome = await ensureMember(db, { email: "newcomer@zabaca.com", name: "Newcomer" });
    expect(outcome.created).toBe(true);

    expect(await requestLink("newcomer@zabaca.com")).toBe("sent");
    expect(sent).toHaveLength(1);
  });

  test("normalizes the address, so a shouted invite is the same Member", async () => {
    const outcome = await ensureMember(db, { email: "  JAMES@Zabaca.com ", name: "James" });
    expect(outcome).toEqual({ userId: "USR-james", created: false });
  });

  test("gives a colliding slug a suffix rather than failing the insert", async () => {
    // `james@other.example` derives the slug `james`, which USR-james holds.
    const outcome = await ensureMember(db, { email: "james@other.example", name: "Other James" });
    expect(outcome.created).toBe(true);
    const rows = await db.select().from(users);
    expect(rows.map((r) => r.slug).sort()).toEqual(["james", "james-2"]);
  });
});
