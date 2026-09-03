/**
 * The free allowance on an unclaimed Principal (ADR-0013).
 *
 * The meter is Observations, because that is the entity an agent files
 * constantly and therefore the only one that scales with cost. The lockout is
 * every corpus **write**: past the cap a write refuses with `CAPACITY_EXCEEDED`
 * carrying the claim URL, so the agent can explain the wall and offer the fix in
 * the conversation where it was hit.
 *
 * Reads are never gated here, and nothing in this module is reachable from
 * `query()`. Refusing to show somebody the notes they already captured breaks
 * the one workflow that matters — reloading context into a fresh session — and
 * turns a growth mechanism into a grievance.
 *
 * The cap is a nudge, not a control. Anyone can mint a fresh Principal and
 * collect the allowance again; ADR-0013 states that rather than defending it.
 * For the same reason the check is not serialised against concurrent writes: two
 * dispatches racing at the boundary may both land, which costs a Principal
 * nothing anybody would defend against.
 */
import { and, count, inArray, isNotNull } from "drizzle-orm";

import type { CruxDb } from "../db/client.js";
import { observations, users } from "../db/schema.js";
import { CapacityExceededError } from "../transitions/errors.js";
import type { Scope } from "./principals.js";

/**
 * Observations an unclaimed Principal may file before writes refuse.
 *
 * Generous on purpose: a number anybody meets during genuine evaluation teaches
 * that intake is expensive, which is the one lesson this product cannot afford.
 * Deployments override it without touching code — see `CRUX_OBSERVATION_CAP`.
 */
export const DEFAULT_OBSERVATION_CAP = 200;

/** How much an unclaimed Principal gets, and where it goes to lift the limit. */
export type Capacity = {
  /** Observations allowed before writes refuse. */
  observationCap: number;
  /** Where a Principal goes to claim itself, quoted back in the refusal. */
  claimUrl: string;
};

/**
 * Read a cap out of deployment configuration.
 *
 * Anything that is not a run of digits falls back to the default rather than
 * throwing: a typo in a Worker var should not take every write on the deployment
 * down with it. Digits rather than `Number()`, so `0x10` and `1e3` — which a
 * human writing a cap did not mean — fall back too. `0` is meaningful: it caps
 * immediately.
 */
export function observationCapFrom(raw: string | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return DEFAULT_OBSERVATION_CAP;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : DEFAULT_OBSERVATION_CAP;
}

/**
 * Has any Principal in this scope been claimed?
 *
 * An email is what claiming attaches (ADR-0013), so its presence is the whole
 * test. Asked across the scope's owner set rather than of the requesting
 * Principal alone, so that once claiming links Principals rather than merging
 * them, one claimed Principal lifts the cap for everything linked to it.
 *
 * Claimed means uncapped here: what a claimed human is *allowed* is a pricing
 * question ADR-0013 leaves open, and this cap exists to create the claim moment
 * rather than to price what follows it. The other half of the ADR's sentence —
 * "the cap applies to the human across all linked Principals" — is structural
 * rather than a number: the meter below runs over the whole owner set, so two
 * Principals one person owns are one allowance and never two.
 *
 * Asked first, so a claimed Principal — every browser Member — never pays for
 * the count below.
 */
async function isClaimed(db: CruxDb, ownerIds: string[]): Promise<boolean> {
  if (!ownerIds.length) return false;
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ownerIds), isNotNull(users.email)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Observations filed by the Principals in this scope.
 *
 * Every one of them, archived included: an Observation is never deleted, and
 * archiving is a judgement about a signal rather than a refund. The meter only
 * ever goes up, which is the honest shape for a cap whose relief is claiming.
 */
async function observationsFiled(db: CruxDb, ownerIds: string[]): Promise<number> {
  if (!ownerIds.length) return 0;
  const rows = await db
    .select({ n: count() })
    .from(observations)
    .where(inArray(observations.reporterId, ownerIds));
  return rows[0]?.n ?? 0;
}

/**
 * Refuse a write when the scope's allowance is spent.
 *
 * Called once per dispatch, on the mutation branch only, so a write added later
 * is capped by construction rather than by remembering to add a check to it.
 */
export async function assertWriteCapacity(
  db: CruxDb,
  scope: Scope,
  capacity: Capacity,
): Promise<void> {
  const ownerIds = scope.ownerIds;
  if (await isClaimed(db, ownerIds)) return;
  const filed = await observationsFiled(db, ownerIds);
  if (filed < capacity.observationCap) return;
  throw new CapacityExceededError(
    `this Principal has filed ${filed} of ${capacity.observationCap} Observations, so writes are paused — claim it at ${capacity.claimUrl} to keep filing. Reading is unaffected.`,
    {
      cap: capacity.observationCap,
      observations: filed,
      claimUrl: capacity.claimUrl,
      principalId: scope.principalId,
    },
  );
}
