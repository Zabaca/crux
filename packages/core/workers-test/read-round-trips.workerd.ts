/**
 * `PROBLEM_DETAIL` asks four independent questions, and the test is that it
 * asks them at once.
 *
 * Everything under a Problem — its Attempts, its Evidence, whether it was
 * abandoned, what became of it — needs the Problem's id and nothing else. They
 * were awaited one at a time, which is what building an object literal in order
 * does, and on D1 that is four sequential round trips for four reads that never
 * needed ordering.
 *
 * The count and the concurrency are both taken at the D1 binding: a later edit
 * that turns the `Promise.all` back into sequential `await`s issues exactly the
 * same statements, so the number of them proves nothing on its own. What
 * changes is how many are in flight at once, and only the binding can see that.
 */
import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1Db, type CruxDb } from "../src/db/client.js";
import { countingD1 } from "../src/db/test-utils.js";
import { applyD1Schema } from "../src/db/d1/index.js";
import {
  attempts,
  evidence,
  observations,
  outcomes,
  problems,
  users,
  workstreams,
} from "../src/db/schema.js";
import { resolveScope, type Scope } from "../src/auth/principals.js";
import { query } from "../src/reads/index.js";

let db: CruxDb;
let scope: Scope;

const OWNER = "USR-owner";
const WS = "WS-owner";

beforeEach(async () => {
  await reset();
  db = createD1Db(env.DB);
  await applyD1Schema(env.DB);
  await db.insert(users).values({ id: OWNER, slug: "owner", name: "Owner" });
  await db.insert(workstreams).values({ id: WS, slug: "owner", title: "Owner", ownerId: OWNER });
  scope = await resolveScope(db, { id: OWNER });
});

/** A Problem with something hanging off every one of the four reads. */
async function seedProblem(): Promise<number> {
  const now = Date.now();
  const inserted = await db
    .insert(problems)
    .values({
      workstreamId: WS,
      title: "slow reads",
      description: "reads are slow",
      createdById: OWNER,
      createdAt: now,
    })
    .returning({ id: problems.id });
  const id = inserted[0]!.id;

  await db.insert(observations).values({
    id: "OBS-1",
    workstreamId: WS,
    content: "a signal",
    reporterId: OWNER,
    createdAt: now,
  });
  await db.insert(evidence).values({
    id: "EVD-1",
    problemId: id,
    observationId: "OBS-1",
    note: "why",
    createdById: OWNER,
    createdAt: now,
  });
  await db.insert(attempts).values({
    id: "ATT-1",
    problemId: id,
    label: "an attempt",
    ref: "ENG-1",
    status: "open",
    createdById: OWNER,
    createdAt: now,
  });
  await db.insert(outcomes).values({
    id: "OUT-1",
    problemId: id,
    observedImpact: "it got faster",
    recordedById: OWNER,
    observedAt: now,
  });
  return id;
}

describe("PROBLEM_DETAIL", () => {
  test("issues its four independent reads together, not one after another", async () => {
    const id = await seedProblem();

    const counted = countingD1(env.DB);
    await query(
      { kind: "PROBLEM_DETAIL", id },
      { db: counted.db, principal: { id: OWNER }, scope },
    );

    // The scope check has to come first — it is what decides whether this
    // Principal may see the Problem at all — so the four that follow it are
    // the ones that can overlap, and all four do.
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(4);

    // Seven statements, three deep: the Problem, then the four together, then
    // the second hop two of them own (the Observations behind the Evidence, and
    // the Outcome's follow-up Problems). Serialized, the same seven were seven
    // round trips.
    expect(counted.statements).toHaveLength(7);
  });

  test("still answers the same thing, and still refuses another tenant's Problem", async () => {
    const id = await seedProblem();

    const detail = (await query(
      { kind: "PROBLEM_DETAIL", id },
      { db, principal: { id: OWNER }, scope },
    )) as {
      attempts: unknown[];
      evidence: Array<{ observation: { id: string } | null }>;
      abandonment: unknown;
      outcome: { id: string } | null;
    };
    expect(detail.attempts).toHaveLength(1);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]!.observation?.id).toBe("OBS-1");
    expect(detail.abandonment).toBeNull();
    expect(detail.outcome?.id).toBe("OUT-1");

    // A Principal with no claim on this Workstream reads it as missing, which
    // is the same answer a Problem that never existed gets (ADR-0013).
    await db.insert(users).values({ id: "USR-other", slug: "other", name: "Other" });
    const stranger = await resolveScope(db, { id: "USR-other" });
    expect(
      await query(
        { kind: "PROBLEM_DETAIL", id },
        { db, principal: { id: "USR-other" }, scope: stranger },
      ),
    ).toBeNull();
  });

  test("a Problem with nothing hanging off it is still one wave, not four", async () => {
    const inserted = await db
      .insert(problems)
      .values({
        workstreamId: WS,
        title: "bare",
        description: "nothing hangs off it",
        createdById: OWNER,
        createdAt: Date.now(),
      })
      .returning({ id: problems.id });

    const counted = countingD1(env.DB);
    await query(
      { kind: "PROBLEM_DETAIL", id: inserted[0]!.id },
      { db: counted.db, principal: { id: OWNER }, scope },
    );

    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(4);
    // Five: the Problem, then the four. Neither second hop happens — there are
    // no Observations to fetch and no Outcome to fetch follow-ups for.
    expect(counted.statements).toHaveLength(5);
  });
});
