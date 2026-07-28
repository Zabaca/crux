/**
 * Claiming a migrated `users` row. The case that matters is the real one: a
 * corpus loaded from the single-machine database authors its rows against a
 * `users` row that has no credential, and the person it names must be able to
 * sign in *as that row* rather than as a second identity.
 *
 * Exercised against a real D1 inside workerd, since Better Auth's adapter and
 * hashing are what actually run there (ADR-0006).
 */
import { env, reset } from "cloudflare:test";
import { describe, test, expect, beforeEach } from "vitest";
import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { users, problems, workstreams } from "../src/db/schema.js";
import { createAuth, type CruxAuth } from "../src/auth/better-auth.js";
import { claimUserByEmail } from "../src/auth/claim.js";

const PASSWORD = "correct-horse-battery-staple";

let db: CruxDb;
let auth: CruxAuth;

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  auth = createAuth(db, { secret: "s".repeat(40), baseURL: "http://localhost" });
  await db.insert(users).values({
    id: "USR-james",
    slug: "james",
    name: "James",
    email: "james@zabaca.com",
  });
});

describe("claiming a migrated user", () => {
  test("attaches a credential to the existing row and signs in as it", async () => {
    const outcome = await claimUserByEmail(auth, {
      email: "james@zabaca.com",
      password: PASSWORD,
    });
    expect(outcome).toEqual({ claimed: true, userId: "USR-james" });

    const signIn = await auth.api.signInEmail({
      body: { email: "james@zabaca.com", password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.ok).toBe(true);
    const body = (await signIn.json()) as { user?: { id?: string } };
    expect(body.user?.id).toBe("USR-james");
  });

  test("the claimed row keeps its authorship — no second identity", async () => {
    await db.insert(workstreams).values({ id: "WS-x", slug: "x", title: "X" });
    await db.insert(problems).values({
      workstreamId: "WS-x",
      title: "something worth solving",
      description: "filed before the corpus moved to the cloud",
      createdById: "USR-james",
    });

    await claimUserByEmail(auth, { email: "james@zabaca.com", password: PASSWORD });

    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    const authored = await db.select().from(problems);
    expect(authored[0]?.createdById).toBe("USR-james");
  });

  test("declines a row that already has a credential", async () => {
    await claimUserByEmail(auth, { email: "james@zabaca.com", password: PASSWORD });
    const second = await claimUserByEmail(auth, {
      email: "james@zabaca.com",
      password: "a-different-password-entirely",
    });
    expect(second).toEqual({ claimed: false, reason: "already-has-credentials" });

    // The original credential still works: a second claim must not behave as a
    // password reset, or an invite becomes a way to take over a Member.
    const signIn = await auth.api.signInEmail({
      body: { email: "james@zabaca.com", password: PASSWORD },
      asResponse: true,
    });
    expect(signIn.ok).toBe(true);
  });

  test("declines an address with no user row", async () => {
    const outcome = await claimUserByEmail(auth, {
      email: "nobody@zabaca.com",
      password: PASSWORD,
    });
    expect(outcome).toEqual({ claimed: false, reason: "no-such-user" });
  });
});
