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
 * that it has no email. Claiming attaches one (CRUX-VIZW40); until then the row
 * is nameless in the human sense and reachable only by the token it was minted
 * with.
 */
import { and, eq, inArray } from "drizzle-orm";

import type { CruxDb } from "../db/client.js";
import { attempts, observations, problems, users, workstreams } from "../db/schema.js";
import { NotFoundError } from "../transitions/errors.js";
import { mintToken } from "./tokens.js";

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
function randomSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * The Principals whose corpus `principalId` may read — the scoping set every
 * read is filtered through.
 *
 * Today that is exactly the requesting Principal. It is a function and not an
 * inlined `eq()` because claiming widens it: an email arriving on a Principal
 * links rather than merges (ADR-0013), so tenancy becomes "every Principal
 * claimed by me" and that is a change to this one answer rather than to twenty
 * reads. Returning the set — not a predicate — keeps the widening a matter of
 * adding ids.
 */
export async function visiblePrincipalIds(db: CruxDb, principalId: string): Promise<string[]> {
  // Cheap existence check, so a token naming a row that has since been deleted
  // scopes to nothing rather than to a set containing a dangling id.
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, principalId))
    .limit(1);
  return rows.length ? [principalId] : [];
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

export async function resolveScope(db: CruxDb, principal: Principal): Promise<Scope> {
  const owners = await visiblePrincipalIds(db, principal.id);
  const rows = owners.length
    ? await db
        .select({ id: workstreams.id })
        .from(workstreams)
        .where(inArray(workstreams.ownerId, owners))
    : [];
  const ids = rows.map((r) => r.id);
  const set = new Set(ids);
  return {
    principalId: principal.id,
    ownerIds: owners,
    workstreamIds: ids,
    has: (workstreamId: string) => set.has(workstreamId),
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

/** The Workstream `idOrSlug` names, if this Principal owns it. */
export async function requireWorkstreamInScope(db: CruxDb, idOrSlug: string, scope: Scope) {
  const byId = (
    await db.select().from(workstreams).where(eq(workstreams.id, idOrSlug)).limit(1)
  )[0];
  const row =
    byId ?? (await db.select().from(workstreams).where(eq(workstreams.slug, idOrSlug)).limit(1))[0];
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
