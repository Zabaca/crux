/**
 * Principals — the identity a client acts as, and the boundary every read is
 * scoped to (ADR-0013).
 *
 * A Principal is a token, not a person. First contact with a deployment mints
 * one with no invite and no email; everything filed through it belongs to it.
 * Physically it is a row in `users`, which is deliberate: ADR-0007 has one
 * identity table and two front doors, and every `created_by_id` foreign key in
 * the corpus already points at it. A second table would mean "who did this" had
 * two answers to keep in agreement forever.
 *
 * The only thing that distinguishes an anonymous Principal from a Member is
 * that it has no email. Claiming attaches one (`auth/claims.ts`); until then the row
 * is nameless in the human sense and reachable only by the token it was minted
 * with.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { CruxDb } from "../db/client.js";
import { apiTokens, attempts, observations, problems, users, workstreams } from "../db/schema.js";
import { NotFoundError } from "../transitions/errors.js";
import { hashToken, mintToken, timingSafeEqualHex } from "./tokens.js";

/** What a mint hands back: the row's id, and the token that acts as it (once). */
export type MintedPrincipal = {
  principalId: string;
  name: string;
  token: string;
  tokenId: string;
};

/**
 * The name an anonymous Principal carries.
 *
 * There is no way to choose one. `users.name` is NOT NULL and the mint is
 * unauthenticated, so a caller-supplied name would be the one field an
 * anonymous client could write into the database, for no purpose ADR-0013 asks
 * for. Claiming is what gives a Principal a human name.
 */
const ANONYMOUS_NAME = "Anonymous";

/**
 * Mint a Principal and a bearer token for it.
 *
 * Unauthenticated by construction — this is what a client with no configuration
 * calls, so there is nothing to authenticate it *with*. ADR-0013 states rather
 * than defends the consequence: anyone can mint unlimited Principals, and
 * closing that would mean fingerprinting, which costs more than it saves.
 */
export async function mintPrincipal(db: CruxDb): Promise<MintedPrincipal> {
  const suffix = randomSuffix();
  const principalId = `USR-${suffix}`;
  await db.insert(users).values({
    id: principalId,
    // Derived from the id rather than from the name: `users.slug` is unique and
    // NOT NULL, and two anonymous Principals would otherwise both want "anonymous".
    slug: `anon-${suffix}`,
    name: ANONYMOUS_NAME,
    email: null,
  });
  const minted = await mintToken(db, { userId: principalId, name: "first use" });
  return { principalId, name: ANONYMOUS_NAME, token: minted.token, tokenId: minted.id };
}

/** 16 hex characters of randomness — enough that two mints never collide. */
export function randomSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

/**
 * What one Principal may touch, resolved once per request.
 *
 * Tenancy hangs off the Workstream because everything else does: an Observation,
 * a Problem and everything under a Problem reach exactly one Workstream, so the
 * set of Workstream ids this Principal owns *is* the boundary. Resolving it once
 * makes the check a set membership rather than a join repeated in every read,
 * and makes "which rows can this request see" a single readable answer.
 *
 * Both entry points take one: `query()` so a read cannot leak, and
 * `dispatch()` so a write cannot reach across the boundary and then be read back
 * legitimately — an unscoped `ADD_EVIDENCE` linking somebody else's Observation
 * would be a disclosure through a read that is doing its job.
 */
export type Scope = {
  principalId: string;
  /** Every Principal whose corpus this requester may see — the requester, plus
   * whatever claiming has linked to it. The set capacity is metered over, so
   * "what I can read" and "what counts against my allowance" are one answer. */
  ownerIds: string[];
  /** Workstream ids owned by a Principal this requester can see. */
  workstreamIds: string[];
  /** Is this Workstream inside the boundary? */
  has(workstreamId: string): boolean;
};

/**
 * Who a Principal is allowed to read *for*, and what they own — in one
 * statement.
 *
 * "Every Principal claimed by me" (ADR-0013) is three lookups on `users` and a
 * lookup on `workstreams`, and every one of them was awaiting the one before
 * it. On D1 that depth is the cost: four round trips at ~60ms each, paid by
 * every read on a corpus of any size, including an empty one. They are all one
 * join apart, so they collapse:
 *
 *   self  — the row the request resolved to, which must not be removed
 *   root  — the human it answers to: itself, or whoever claimed it
 *   owner — root, plus everything else root has claimed
 *   ws    — the Workstreams those owners hold
 *
 * The joins after `self` are LEFT joins on purpose. A removed root, or a self
 * whose claim points at a row that is gone, must scope to *nothing* while
 * leaving the requester authenticated — a token whose corpus is empty is not a
 * token that failed to authenticate, and collapsing the two would turn a
 * removal into a 401 for a Principal that still exists.
 *
 * The set stays symmetric — a token linked to a human reads what that human
 * owns, and the reverse — for the reason it always did: claiming is what the
 * person did to say the two are one.
 */
const selfUser = alias(users, "scope_self");
const rootUser = alias(users, "scope_root");
const ownerUser = alias(users, "scope_owner");

/** root = whoever this Principal answers to, and they must still be a Member. */
const rootJoin = and(
  eq(rootUser.id, sql`coalesce(${selfUser.claimedByUserId}, ${selfUser.id})`),
  isNull(rootUser.removedAt),
);

/** owner = the root itself, plus every Principal that root has claimed. */
const ownerJoin = and(
  or(eq(ownerUser.id, rootUser.id), eq(ownerUser.claimedByUserId, rootUser.id)),
  isNull(ownerUser.removedAt),
);

/** One row per (owner, workstream) pair; either column is null when the join
 * found nothing, which is how an empty scope arrives. */
type ScopeRow = { ownerId: string | null; workstreamId: string | null };

function scopeFromRows(principalId: string, rows: ScopeRow[]): Scope {
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter(isPresent))];
  const workstreamIds = [...new Set(rows.map((r) => r.workstreamId).filter(isPresent))];
  const set = new Set(workstreamIds);
  return {
    principalId,
    ownerIds,
    workstreamIds,
    has: (workstreamId: string) => set.has(workstreamId),
  };
}

function isPresent(value: string | null): value is string {
  return value !== null;
}

/**
 * Resolve a scope from a Principal id — the browser door, where the identity
 * came from a Better Auth session and there is no `api_tokens` row to join
 * through (ADR-0007).
 */
export async function resolveScope(db: CruxDb, principal: Principal): Promise<Scope> {
  const rows = await db
    .select({ ownerId: ownerUser.id, workstreamId: workstreams.id })
    .from(selfUser)
    .leftJoin(rootUser, rootJoin)
    .leftJoin(ownerUser, ownerJoin)
    .leftJoin(workstreams, eq(workstreams.ownerId, ownerUser.id))
    .where(and(eq(selfUser.id, principal.id), isNull(selfUser.removedAt)));
  return scopeFromRows(principal.id, rows);
}

/** A bearer token resolved to who it acts as and what that Principal may see. */
export type AuthenticatedScope = {
  principal: Principal;
  tokenId: string;
  scope: Scope;
};

/**
 * The CLI door: authenticate a bearer token *and* resolve its scope, in one
 * round trip.
 *
 * Same query as `resolveScope`, entered one join earlier — through the token
 * row rather than through the user row. There is no separate "just
 * authenticate" call: a second copy of the removal and revocation predicates is
 * how one of them ends up missed.
 *
 * The stored hash is still read back and compared in constant time. The `where`
 * clause is an index probe and says nothing about how long a mismatch takes to
 * reject, so the comparison stays on a value the row handed us.
 */
export async function authenticateAndResolveScope(
  db: CruxDb,
  presented: string | null | undefined,
): Promise<AuthenticatedScope | null> {
  if (!presented) return null;
  const hash = await hashToken(presented);
  const rows = await db
    .select({
      tokenId: apiTokens.id,
      tokenHash: apiTokens.tokenHash,
      userId: apiTokens.userId,
      ownerId: ownerUser.id,
      workstreamId: workstreams.id,
    })
    .from(apiTokens)
    // Inner, unlike the joins below it: a token whose owner is gone or removed
    // does not authenticate at all, which is what makes removal close every
    // token that Member ever minted (ADR-0011).
    .innerJoin(selfUser, and(eq(selfUser.id, apiTokens.userId), isNull(selfUser.removedAt)))
    .leftJoin(rootUser, rootJoin)
    .leftJoin(ownerUser, ownerJoin)
    .leftJoin(workstreams, eq(workstreams.ownerId, ownerUser.id))
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)));
  const first = rows[0];
  if (!first) return null;
  if (!timingSafeEqualHex(first.tokenHash, hash)) return null;
  return {
    principal: { id: first.userId },
    tokenId: first.tokenId,
    scope: scopeFromRows(first.userId, rows),
  };
}

/** Who is asking. Resolved server-side from a bearer token or a session. */
export type Principal = { id: string };

/**
 * Every Problem id inside the scope, as a subquery.
 *
 * The reads and writes that are handed a Problem-child id — an Evidence row, an
 * Attempt, an Outcome — have no Workstream column of their own, so they gate on
 * this instead. It stays a subquery rather than a materialised id list because
 * the number of Problems is unbounded while the number of Workstreams is not.
 */
export function problemsInScope(db: CruxDb, scope: Scope) {
  return db
    .select({ id: problems.id })
    .from(problems)
    .where(inArray(problems.workstreamId, scope.workstreamIds));
}

// ---------------------------------------------------------------------------
// Scope-gated resolvers
// ---------------------------------------------------------------------------

/**
 * Resolving an id inside a scope, in one place.
 *
 * `query()` and `dispatch()` both take an id from the caller and both have to
 * ask the same question of it, so the gate lives here rather than once on each
 * side. ADR-0013 names the failure mode this is defending against — "one missed
 * predicate is a cross-tenant disclosure, not a bug" — and two copies of a
 * predicate is how one of them ends up missed.
 *
 * Every one of these reports a row outside the scope as *missing*, in the same
 * words and with the same code as one that never existed. An error that
 * distinguished "not yours" from "not there" would turn any read into an oracle
 * for what exists on the deployment.
 */

/**
 * The Workstream this requester means by `slug`, or undefined.
 *
 * A slug is unique to its owner rather than to the deployment, so the lookup
 * has to be filtered to the scope *before* it picks a row: an unscoped
 * `limit(1)` would happily return a stranger's Workstream and then refuse the
 * caller their own.
 *
 * Inside one scope a slug can still name two rows — claiming links Principals
 * that each already owned one — so the choice is made deterministic rather than
 * left to row order: the requester's own Principal wins, then the lowest id.
 * New duplicates cannot be created; `ADD_WORKSTREAM` and `RENAME_WORKSTREAM`
 * refuse a slug anything in the scope already holds.
 */
export async function findWorkstreamBySlugInScope(db: CruxDb, slug: string, scope: Scope) {
  const rows = await db
    .select()
    .from(workstreams)
    .where(and(eq(workstreams.slug, slug), inArray(workstreams.id, scope.workstreamIds)));
  return rows.sort((a, b) => {
    const own = Number(b.ownerId === scope.principalId) - Number(a.ownerId === scope.principalId);
    return own !== 0 ? own : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0];
}

/** The Workstream `idOrSlug` names, if this Principal owns it. */
export async function requireWorkstreamInScope(db: CruxDb, idOrSlug: string, scope: Scope) {
  const byId = (
    await db.select().from(workstreams).where(eq(workstreams.id, idOrSlug)).limit(1)
  )[0];
  const row =
    byId && scope.has(byId.id) ? byId : await findWorkstreamBySlugInScope(db, idOrSlug, scope);
  if (!row || !scope.has(row.id)) {
    throw new NotFoundError(`workstream not found: ${idOrSlug}`, { id: idOrSlug });
  }
  return row;
}

/** The Problem `raw` names, or null when it is missing or out of scope. */
export async function findProblemInScope(db: CruxDb, raw: string | number, scope: Scope) {
  const id = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  const row = (await db.select().from(problems).where(eq(problems.id, id)).limit(1))[0];
  return row && scope.has(row.workstreamId) ? row : null;
}

/** The same, for the reads and writes that must refuse rather than answer null. */
export async function requireProblemInScope(db: CruxDb, raw: string | number, scope: Scope) {
  const row = await findProblemInScope(db, raw, scope);
  if (!row) throw new NotFoundError(`problem not found: ${raw}`, { id: raw });
  return row;
}

/** The Observation `id` names, if it sits in a Workstream this Principal owns. */
export async function requireObservationInScope(db: CruxDb, id: string, scope: Scope) {
  const row = (await db.select().from(observations).where(eq(observations.id, id)).limit(1))[0];
  if (!row || !scope.has(row.workstreamId)) {
    throw new NotFoundError(`observation not found: ${id}`, { id });
  }
  return row;
}

/** The Attempt `id` names, if its Problem is inside the scope. */
export async function requireAttemptInScope(db: CruxDb, id: string, scope: Scope) {
  const row = (
    await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, id), inArray(attempts.problemId, problemsInScope(db, scope))))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError(`attempt not found: ${id}`, { id });
  return row;
}
