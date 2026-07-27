/**
 * Slice 2 — the token store. Bearer tokens are minted against a user, resolve
 * back to that user, and stop resolving once revoked. Exercised through the
 * public mint/authenticate/revoke interface against a real (libSQL) db.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, type TestDb } from "../../db/test-utils.js";
import { users } from "../../db/schema.js";
import { mintToken, revokeToken, authenticateToken, timingSafeEqualHex } from "../tokens.js";

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await t.db.insert(users).values({ id: "USR-james", slug: "james", name: "James Lee" });
});
afterEach(() => t.cleanup());

describe("token lifecycle", () => {
  test("a minted token resolves to its user", async () => {
    const { token } = await mintToken(t.db, { userId: "USR-james", name: "laptop" });
    const who = await authenticateToken(t.db, token);
    expect(who?.userId).toBe("USR-james");
  });

  test("the plaintext token is returned once and is not stored verbatim", async () => {
    const { token, id } = await mintToken(t.db, { userId: "USR-james" });
    expect(token).toStartWith("crux_");
    // The row must not hold the plaintext token.
    const { apiTokens } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    const row = (await t.db.select().from(apiTokens).where(eq(apiTokens.id, id)))[0]!;
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash.length).toBe(64); // sha-256 hex
  });

  test("a wrong token does not authenticate", async () => {
    await mintToken(t.db, { userId: "USR-james" });
    expect(await authenticateToken(t.db, "crux_not_a_real_token")).toBeNull();
  });

  test("a revoked token stops working", async () => {
    const { token, id } = await mintToken(t.db, { userId: "USR-james" });
    expect(await authenticateToken(t.db, token)).not.toBeNull();
    await revokeToken(t.db, id);
    expect(await authenticateToken(t.db, token)).toBeNull();
  });
});

describe("timingSafeEqualHex", () => {
  test("true only for identical equal-length hex, false otherwise", () => {
    expect(timingSafeEqualHex("abcd", "abcd")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abce")).toBe(false);
    expect(timingSafeEqualHex("abcd", "abcde")).toBe(false); // length mismatch
  });
});
