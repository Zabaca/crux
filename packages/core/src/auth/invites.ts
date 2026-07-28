/**
 * Invites — the only way a Member joins the Workspace.
 *
 * Membership is coarse by design (ADR-0003): the deployment is the tenant
 * boundary, so an invite grants the whole corpus and there is nothing narrower
 * to grant. That is why this module has no roles, no scopes and no Workspace id
 * — an invite is just a one-time permission to create a `users` row.
 *
 * The token is handled the way CLI tokens are (`./tokens.ts`): shown once,
 * stored only as a SHA-256 hash, confirmed in constant time. An invite is
 * single-use via `acceptedAt` rather than by deletion, so who invited whom
 * survives the redemption.
 */
import { and, eq, isNull } from "drizzle-orm";

import type { CruxDb } from "../db/client.js";
import { invites } from "../db/auth-schema.js";
import { hashToken, timingSafeEqualHex } from "./tokens.js";

/** How long an unredeemed invite stays valid. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const INVITE_PREFIX = "inv_";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

export type Invite = typeof invites.$inferSelect;
export type CreatedInvite = { id: string; token: string; email: string; expiresAt: number };

/** Issue an invite for `email`. The plaintext token is returned exactly once. */
export async function createInvite(
  db: CruxDb,
  opts: { email: string; invitedById: string; now?: number },
): Promise<CreatedInvite> {
  const email = normalizeEmail(opts.email);
  const token = INVITE_PREFIX + randomHex(24);
  const id = `INV-${randomHex(8)}`;
  const now = opts.now ?? Date.now();
  const expiresAt = now + INVITE_TTL_MS;
  await db.insert(invites).values({
    id,
    email,
    tokenHash: await hashToken(token),
    invitedById: opts.invitedById,
    createdAt: now,
    expiresAt,
  });
  return { id, token, email, expiresAt };
}

/**
 * Resolve a presented invite token to the pending invite it names, or null if
 * the token is unknown, already redeemed, or expired.
 */
export async function findPendingInvite(
  db: CruxDb,
  token: string | null | undefined,
  now = Date.now(),
): Promise<Invite | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, hash), isNull(invites.acceptedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!timingSafeEqualHex(row.tokenHash, hash)) return null;
  if (row.expiresAt <= now) return null;
  return row;
}

/**
 * Mark an invite redeemed. Conditional on it still being pending, so two
 * simultaneous redemptions cannot both create an account: the loser updates
 * zero rows and is told so.
 */
export async function acceptInvite(
  db: CruxDb,
  opts: { inviteId: string; userId: string; now?: number },
): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const result = await db
    .update(invites)
    .set({ acceptedAt: now, acceptedUserId: opts.userId })
    .where(and(eq(invites.id, opts.inviteId), isNull(invites.acceptedAt)));
  return rowsWritten(result) > 0;
}

/** Every invite, newest first — what the Members page lists as pending. */
export async function listInvites(db: CruxDb): Promise<Invite[]> {
  const rows = await db.select().from(invites);
  return [...rows].sort((a, b) => b.createdAt - a.createdAt);
}

/** Lower-cased and trimmed, so an invite matches the address that redeems it. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A `users.slug` derived from an email local part, uniqueness checked by caller. */
export function slugFromEmail(email: string): string {
  const local = normalizeEmail(email).split("@")[0] ?? "member";
  const slug = local.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "member";
}

/** drizzle's D1 update result reports affected rows in `meta.changes`. */
function rowsWritten(result: unknown): number {
  const meta = (result as { meta?: { changes?: number } } | undefined)?.meta;
  return meta?.changes ?? 0;
}
