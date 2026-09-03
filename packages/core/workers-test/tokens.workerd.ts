/**
 * The token store. Bearer tokens are minted against a user, resolve back to that
 * user, and stop resolving once revoked — exercised through the public
 * mint/authenticate/revoke interface against a real D1 inside workerd, which is
 * the runtime that will actually authenticate every request (ADR-0006).
 *
 * Authenticating is `authenticateAndResolveScope`: there is one way in, and it
 * answers who the token acts as and what they may see in the same statement.
 * `authorization-round-trips.workerd.ts` pins that it stays one.
 */
import { env, reset } from "cloudflare:test";
import { describe, test, expect, beforeEach } from "vitest";
import { createD1Db, type CruxDb } from "../src/db/client.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import { users } from "../src/db/schema.js";
import { mintToken, revokeToken, timingSafeEqualHex } from "../src/auth/tokens.js";
import { authenticateAndResolveScope } from "../src/auth/principals.js";

let db: CruxDb;

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  await db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
});

describe("token lifecycle", () => {
  test("a minted token resolves to its user", async () => {
    const { token } = await mintToken(db, { userId: "USR-james", name: "laptop" });
    const who = await authenticateAndResolveScope(db, token);
    expect(who?.principal.id).toBe("USR-james");
  });

  test("the plaintext token is returned once and is not stored verbatim", async () => {
    const { token, id } = await mintToken(db, { userId: "USR-james" });
    expect(token.startsWith("crux_")).toBe(true);
    // The row must not hold the plaintext token.
    const { apiTokens } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const row = (await db.select().from(apiTokens).where(eq(apiTokens.id, id)))[0]!;
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash.length).toBe(64); // sha-256 hex
  });

  test("a wrong token does not authenticate", async () => {
    await mintToken(db, { userId: "USR-james" });
    expect(await authenticateAndResolveScope(db, "crux_not_a_real_token")).toBeNull();
  });

  test("a revoked token stops working", async () => {
    const { token, id } = await mintToken(db, { userId: "USR-james" });
    expect(await authenticateAndResolveScope(db, token)).not.toBeNull();
    await revokeToken(db, { tokenId: id, userId: "USR-james" });
    expect(await authenticateAndResolveScope(db, token)).toBeNull();
  });
});

describe("timingSafeEqualHex", () => {
  test("true only for identical equal-length hex, false otherwise", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false); // length mismatch
  });
});
