/**
 * CLI bearer tokens — the identity store the cloud API authenticates against.
 *
 * A token is a random opaque string shown to the user exactly once at mint time.
 * Only its SHA-256 hash is stored, so a leaked database yields no usable tokens.
 * Authentication hashes the presented token, looks up the (indexed) hash, and
 * confirms it with a constant-time comparison before resolving the user.
 *
 * Everything here uses the Web Crypto global (`crypto.subtle`, `getRandomValues`),
 * which exists in both workerd and Bun — no `node:crypto`, so it runs in the Worker.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { apiTokens } from "../db/schema.js";

const TOKEN_PREFIX = "crux_";

/** Generate a fresh opaque bearer token: `crux_` + 32 random bytes as hex. */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return TOKEN_PREFIX + toHex(bytes);
}

/** SHA-256 of `input`, hex-encoded. */
export async function hashToken(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time comparison of two hex strings. Returns false immediately on a
 * length mismatch (the lengths themselves are not secret); otherwise the loop
 * visits every character so timing does not leak where the first difference is.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** A short random id for the token row. */
function newTokenId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `TOK-${toHex(bytes)}`;
}

export type MintedToken = { id: string; token: string };

/**
 * Mint a token for a user. Returns the plaintext token (shown once) and the row
 * id used to revoke it. Only the hash is persisted.
 */
export async function mintToken(
  db: CruxDb,
  opts: { userId: string; name?: string },
): Promise<MintedToken> {
  const token = generateToken();
  const id = newTokenId();
  await db.insert(apiTokens).values({
    id,
    userId: opts.userId,
    tokenHash: await hashToken(token),
    name: opts.name ?? null,
  });
  return { id, token };
}

/**
 * Revoke one of `userId`'s tokens. A revoked token never authenticates again.
 *
 * The owner is a required argument rather than an optional filter, because the
 * id being revoked arrives from a form field: a caller that could omit the
 * owner would let any Member revoke any other Member's token by guessing a row
 * id. Returns false when the token does not exist *or* belongs to someone else
 * — the two are deliberately indistinguishable to the caller.
 */
export async function revokeToken(
  db: CruxDb,
  opts: { tokenId: string; userId: string },
): Promise<boolean> {
  const result = await db
    .update(apiTokens)
    .set({ revokedAt: Date.now() })
    .where(and(eq(apiTokens.id, opts.tokenId), eq(apiTokens.userId, opts.userId)));
  const meta = (result as { meta?: { changes?: number } } | undefined)?.meta;
  return (meta?.changes ?? 0) > 0;
}

export type AuthedToken = { userId: string; tokenId: string };

/**
 * Resolve a presented bearer token to its (active) owner, or null if the token
 * is unknown or revoked. The stored hash is confirmed in constant time.
 */
export async function authenticateToken(
  db: CruxDb,
  presented: string | null | undefined,
): Promise<AuthedToken | null> {
  if (!presented) return null;
  const hash = await hashToken(presented);
  const rows = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, tokenHash: apiTokens.tokenHash })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!timingSafeEqualHex(row.tokenHash, hash)) return null;
  return { userId: row.userId, tokenId: row.id };
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
