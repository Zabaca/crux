/**
 * Claiming a Principal — attaching a human to the token that has been filing
 * (ADR-0013).
 *
 * Two shapes, one mechanism. An address nobody has *names* the Principal: the
 * row it already is grows an email, a name and a slug, and becomes the human.
 * An address that already belongs to somebody *links* the Principal to them —
 * `claimed_by_user_id`, an edge — and nothing else is touched. Tenancy then
 * resolves to "every Principal claimed by me" (`visiblePrincipalIds`), which is
 * how one person ends up reading two machines' corpora without either corpus
 * being rewritten.
 *
 * Merging was never on the table. Re-pointing `reporter_id` and `created_by_id`
 * at a single surviving row would rewrite authorship that a different token
 * honestly wrote, which is the same lie ADR-0011 refused when it declined to
 * reassign a removed Member's entries. Linking says the true thing: two
 * Principals, one person.
 *
 * **The edge is written only after the address is proved.** A claim requested
 * is a row here; a claim applied is the update below, and only a token that
 * came back out of the mailbox gets there. Writing the edge when the claim was
 * *asked for* would let anyone type a stranger's address and be linked to them,
 * and since the link is symmetric that is a cross-tenant read — the one failure
 * ADR-0013 names as "not a bug".
 *
 * The token is handled exactly the way invites and CLI tokens are: shown once,
 * stored as a SHA-256 hash, single-use via `claimed_at` rather than by
 * deletion, so a spent claim is refused rather than replayed.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";

import type { CruxDb } from "../db/client.js";
import { authUsers, claims } from "../db/auth-schema.js";
import { CruxError } from "../transitions/errors.js";
import { normalizeEmail, slugFromEmail } from "./invites.js";
import { uniqueSlug } from "./membership.js";
import { hashToken, timingSafeEqualHex } from "./tokens.js";

/** How long an unopened claim link stays good. Same fifteen minutes as a
 * sign-in link: it is the same kind of thing arriving in the same inbox. */
export const CLAIM_TTL_MS = 15 * 60 * 1000;

const CLAIM_PREFIX = "clm_";

export type Claim = typeof claims.$inferSelect;
export type CreatedClaim = { id: string; token: string; email: string; expiresAt: number };

/** The two ways a claim can land, and what it landed on. */
export type ClaimOutcome = {
  /** `named` — the address was new, so the Principal *is* the human now.
   *  `linked` — the address had a row, so the Principal points at it. */
  kind: "named" | "linked";
  principalId: string;
  email: string;
};

/** A claim that cannot be made: already claimed, spent, expired, unknown. */
export class ClaimError extends CruxError {
  constructor(code: "ALREADY_EXISTS" | "NOT_FOUND" | "VALIDATION_ERROR", message: string) {
    super(code, message);
    this.name = "ClaimError";
  }
}

/**
 * The Principal `principalId` names, if it is still claimable.
 *
 * Claimable means: it exists, it is not removed, and it carries neither an
 * email nor an edge. Refusing an already-claimed Principal is what keeps
 * `claimed_by_user_id` pointing at a *root* — allow a second claim and the
 * edges chain, and "who owns this corpus" stops being one hop away.
 */
export async function requireClaimablePrincipal(db: CruxDb, principalId: string) {
  const row = (
    await db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        claimedByUserId: authUsers.claimedByUserId,
        removedAt: authUsers.removedAt,
      })
      .from(authUsers)
      .where(eq(authUsers.id, principalId))
      .limit(1)
  )[0];
  if (!row || row.removedAt !== null) {
    throw new ClaimError("NOT_FOUND", `no such Principal: ${principalId}`);
  }
  if (row.email || row.claimedByUserId) {
    throw new ClaimError(
      "ALREADY_EXISTS",
      `Principal ${principalId} is claimed already — a second claim would rewrite who owns what it filed.`,
    );
  }
  return row;
}

/**
 * Record the intent to claim `principalId` as `email`. The plaintext token is
 * returned exactly once, for the mail.
 */
export async function createClaim(
  db: CruxDb,
  opts: { principalId: string; email: string; now?: number },
): Promise<CreatedClaim> {
  const email = normalizeEmail(opts.email);
  if (!isEmailish(email)) {
    throw new ClaimError("VALIDATION_ERROR", `not an email address: ${opts.email}`);
  }
  await requireClaimablePrincipal(db, opts.principalId);

  const now = opts.now ?? Date.now();
  await refuseIfFlooding(db, opts.principalId, now);

  const token = CLAIM_PREFIX + randomHex(24);
  const id = `CLM-${randomHex(8)}`;
  const expiresAt = now + CLAIM_TTL_MS;
  await db.insert(claims).values({
    id,
    principalId: opts.principalId,
    email,
    tokenHash: await hashToken(token),
    createdAt: now,
    expiresAt,
  });
  return { id, token, email, expiresAt };
}

/**
 * How many claim links one Principal may have outstanding at once.
 *
 * Small, and it exists for one reason: `POST /v1/principals` is unauthenticated
 * and unlimited (ADR-0013), so without a bound here anyone could make the
 * deployment mail an arbitrary address as often as they liked — an amplifier
 * pointed at somebody else's inbox and at this deployment's sending reputation.
 * Signing in cannot be used that way, because it mails only addresses that
 * already have a row; claiming has to name an address that does not, so the
 * bound is the only thing standing in for that gate.
 *
 * Three rather than one, because the first attempt is sometimes a typo and
 * waiting out the expiry for a second try is a bad answer to a slip.
 */
export const MAX_OUTSTANDING_CLAIMS = 3;

/** Refuse when this Principal already has its allowance of live claim links. */
async function refuseIfFlooding(db: CruxDb, principalId: string, now: number): Promise<void> {
  const rows = await db
    .select({ n: count() })
    .from(claims)
    .where(
      and(eq(claims.principalId, principalId), isNull(claims.claimedAt), gt(claims.expiresAt, now)),
    );
  if ((rows[0]?.n ?? 0) >= MAX_OUTSTANDING_CLAIMS) {
    throw new ClaimError(
      "ALREADY_EXISTS",
      `this Principal already has ${MAX_OUTSTANDING_CLAIMS} claim links outstanding — open one of them, or wait for them to expire.`,
    );
  }
}

/**
 * Resolve a presented claim token to the pending claim it names, or null if the
 * token is unknown, already spent, or expired.
 */
export async function findPendingClaim(
  db: CruxDb,
  token: string | null | undefined,
  now = Date.now(),
): Promise<Claim | null> {
  if (!token) return null;
  const hash = await hashToken(token);
  const rows = await db
    .select()
    .from(claims)
    .where(and(eq(claims.tokenHash, hash), isNull(claims.claimedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!timingSafeEqualHex(row.tokenHash, hash)) return null;
  if (row.expiresAt <= now) return null;
  return row;
}

/**
 * Apply a pending claim: name the Principal, or link it to the human who
 * already holds the address.
 *
 * Spending the claim comes first and is conditional on it still being pending,
 * so two clicks on the same link cannot both write — the loser updates zero
 * rows and is told the link is spent. The Principal is re-checked afterwards
 * rather than trusted from the request that created the claim: a second claim
 * link, mailed to a second address, may have landed in between.
 *
 * Nothing the Principal authored is read here, let alone written. That absence
 * is the invariant — see `workers-test/claims.workerd.ts`, which counts it.
 */
export async function applyClaim(
  db: CruxDb,
  opts: { claim: Claim; name?: string; now?: number },
): Promise<ClaimOutcome> {
  const { claim } = opts;
  const now = opts.now ?? Date.now();

  const spent = await db
    .update(claims)
    .set({ claimedAt: now })
    .where(and(eq(claims.id, claim.id), isNull(claims.claimedAt)));
  if (rowsWritten(spent) === 0) {
    throw new ClaimError("NOT_FOUND", "this claim link has been used already.");
  }

  await requireClaimablePrincipal(db, claim.principalId);

  let human = await humanHolding(db, claim.email);

  if (!human) {
    try {
      const named = await db
        .update(authUsers)
        .set({
          email: claim.email,
          // Proved by the token that came back out of the mailbox.
          emailVerified: true,
          name: nameFor(opts.name, claim.email),
          slug: await uniqueSlug(db, slugFromEmail(claim.email)),
          claimedAt: now,
          updatedAt: new Date(now),
        })
        .where(unclaimed(claim.principalId));
      if (rowsWritten(named) === 0) throw claimedInTheMeantime(claim.principalId);
      return { kind: "named", principalId: claim.principalId, email: claim.email };
    } catch (err) {
      // `users.email` is uniquely indexed, so a second link to the *same* new
      // address, opened in the same moment, loses here. It is not an error: the
      // address now has a row, which is the linking case — and the claim is
      // already spent, so failing would burn a single-use link on a race.
      if (!isUniqueViolation(err)) throw err;
      human = await humanHolding(db, claim.email);
      if (!human) throw err;
    }
  }

  if (human.removedAt !== null) {
    // ADR-0011: removal ends the way in, and every gate reads that one column.
    // Linking to a removed row would be a new way in — mint a fresh Principal,
    // claim it to the old address, read the corpus the removal closed. So the
    // address having *ever* had a row is not enough here, unlike `ensureMember`,
    // where a Member deliberately re-invited the person.
    throw new ClaimError(
      "NOT_FOUND",
      `${claim.email} is not an address this deployment can attach a Principal to.`,
    );
  }

  // Defensive: a root never carries an edge, so this collapses to `human.id`.
  // It costs one `??` to guarantee the set in `visiblePrincipalIds` is one hop
  // deep no matter what a future path writes.
  const rootId = human.claimedByUserId ?? human.id;
  const linked = await db
    .update(authUsers)
    .set({ claimedByUserId: rootId, claimedAt: now, updatedAt: new Date(now) })
    .where(unclaimed(claim.principalId));
  if (rowsWritten(linked) === 0) throw claimedInTheMeantime(claim.principalId);
  return { kind: "linked", principalId: claim.principalId, email: claim.email };
}

/** The row holding `email`, removed or not — whether it may be linked to is a
 * separate question, asked by the caller. */
async function humanHolding(db: CruxDb, email: string) {
  return (
    await db
      .select({
        id: authUsers.id,
        claimedByUserId: authUsers.claimedByUserId,
        removedAt: authUsers.removedAt,
      })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1)
  )[0];
}

/** D1 reports a violated unique index in the message and nowhere else. */
function isUniqueViolation(err: unknown): boolean {
  return /UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err));
}

/**
 * The row `principalId` names, and only while it is still unclaimed.
 *
 * The same predicate `requireClaimablePrincipal` asks, restated as the `WHERE`
 * of the write itself. D1 gives this module no transaction to hold across the
 * read and the write, so the check alone would let two links opened at the same
 * second — one naming, one linking — each pass it and then both land, leaving a
 * row carrying an address *and* an edge. Making the write conditional means the
 * loser changes nothing and is told so.
 */
function unclaimed(principalId: string) {
  return and(
    eq(authUsers.id, principalId),
    isNull(authUsers.email),
    isNull(authUsers.claimedByUserId),
  );
}

function claimedInTheMeantime(principalId: string): ClaimError {
  return new ClaimError(
    "ALREADY_EXISTS",
    `Principal ${principalId} was claimed while this link was open.`,
  );
}

/** The name a newly named Principal carries: what the claimer asked for, or
 * the address's local part, which is a better answer than "Anonymous". */
function nameFor(name: string | undefined, email: string): string {
  const trimmed = name?.trim();
  return trimmed || (email.split("@")[0] ?? email);
}

/** The same shape the sign-in form insists on. Deliberately not a grammar for
 * RFC 5321 — the mail either arrives or it does not, and that is the real test. */
export function isEmailish(email: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(email);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

/** drizzle's D1 update result reports affected rows in `meta.changes`. */
function rowsWritten(result: unknown): number {
  const meta = (result as { meta?: { changes?: number } } | undefined)?.meta;
  return meta?.changes ?? 0;
}
