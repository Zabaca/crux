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
  /** Where a Principal goes to claim itself, quoted back in the refusal. Empty
   * when the caller has no deployment address to name one against. */
  claimUrl: string;
};

/**
 * Read a cap out of deployment configuration.
 *
 * Anything that is not a non-negative integer falls back to the default rather
 * than throwing: a typo in a Worker var should not take every write on the
 * deployment down with it. `0` is meaningful — it caps immediately — so it is
 * only the unparseable that falls back.
 */
export function observationCapFrom(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_OBSERVATION_CAP;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_OBSERVATION_CAP;
}

/**
 * Has any Principal in this scope been claimed?
 *
 * An email is what claiming attaches (ADR-0013), so its presence is the whole
 * test. Asked across the scope's owner set rather than of the requesting
 * Principal alone, so that when claiming links Principals rather than merging
 * them, one claimed Principal lifts the cap for everything linked to it —
 * and, symmetrically, the allowances of linked Principals cannot be pooled.
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

/** Observations filed by the Principals in this scope. */
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
  const fix = capacity.claimUrl
    ? `claim it at ${capacity.claimUrl} to keep filing`
    : "claim it to keep filing";
  throw new CapacityExceededError(
    `this Principal has filed ${filed} of ${capacity.observationCap} Observations, so writes are paused — ${fix}. Reading is unaffected.`,
    {
      cap: capacity.observationCap,
      observations: filed,
      claimUrl: capacity.claimUrl,
      principalId: scope.principalId,
    },
  );
}
