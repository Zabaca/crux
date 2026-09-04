/**
 * `PROBLEM_DETAIL` asks five independent questions, and the test is that it
 * asks them at once.
 *
 * Everything under a Problem — its Attempts, its Evidence, whether it was
 * abandoned, what became of it, whether it has been corrected — needs the
 * Problem's id and nothing else. They were awaited one at a time, which is what
 * building an object literal in order does, and on D1 that is five sequential
 * round trips for five reads that never needed ordering.
 *
 * `PROBLEM_SHOW` is held to the same rule, which is what the revision marker
 * had to be built into rather than added after (ADR-0017).
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
  abandonments,
  attempts,
  evidence,
  observations,
  outcomes,
  problems,
  revisions,
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
  test("issues its five independent reads together, not one after another", async () => {
    const id = await seedProblem();
    await db.insert(revisions).values({
      id: "REV-001",
      entity: "problem",
      entityId: String(id),
      changed: JSON.stringify({ title: "slow reads" }),
      revisedById: OWNER,
      revisedAt: Date.now(),
    });

    const counted = countingD1(env.DB);
    const detail = (await query(
      { kind: "PROBLEM_DETAIL", id },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    // The marker the Problem page shows, answered inside the same wave.
    expect(detail.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });

    // The scope check has to come first — it is what decides whether this
    // Principal may see the Problem at all — so the five that follow it are
    // the ones that can overlap, and all five do.
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(5);

    // Nine statements, three deep: the Problem, then the five together — the
    // Problem's own revision marker among them, which is what keeps the
    // browser's marker free (ADR-0017) — then the second hop two of them own:
    // the Observations behind the Evidence, which the Evidence marker rides
    // alongside, and the Outcome's follow-up Problems. Serialized, the same
    // nine were nine round trips.
    expect(counted.statements).toHaveLength(9);
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
      revision: unknown;
    };
    expect(detail.attempts).toHaveLength(1);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]!.observation?.id).toBe("OBS-1");
    expect(detail.abandonment).toBeNull();
    expect(detail.outcome?.id).toBe("OUT-1");
    // Nobody has corrected this Problem, so the marker is null rather than a
    // zero — which is what lets the page render nothing at all (ADR-0017).
    expect(detail.revision).toBeNull();

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

  test("a Problem with nothing hanging off it is still one wave, not five", async () => {
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

    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(5);
    // Seven: the Problem, then the five, then the Evidence revision markers —
    // which are grouped by entity rather than by id, so they are asked for even
    // when there is no Evidence. Neither of the other second hops happens: there
    // are no Observations to fetch and no Outcome to fetch follow-ups for.
    expect(counted.statements).toHaveLength(7);
  });
});

describe("OBSERVATION_DETAIL", () => {
  test("the revision marker rides the row's own statement", async () => {
    await db.insert(observations).values({
      id: "OBS-002",
      workstreamId: WS,
      reporterId: OWNER,
      content: "the digest takes 12 seconds",
    });
    await db.insert(revisions).values({
      id: "REV-002",
      entity: "observation",
      entityId: "OBS-002",
      changed: JSON.stringify({ content: "the digest takes 4 seconds" }),
      revisedById: OWNER,
      revisedAt: Date.now(),
    });

    const counted = countingD1(env.DB);
    const detail = (await query(
      { kind: "OBSERVATION_DETAIL", id: "OBS-002" },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    // The Observation page renders this marker, and it must not have cost the
    // page a hop to get it (ADR-0017): the row and the marker go together.
    expect(detail.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(2);
    // Four, two deep: the row and its marker together, then the Evidence this
    // Observation supports — with the Evidence markers beside it, in the same
    // wave. The scope check here is the row itself, so there is no fifth.
    expect(counted.statements).toHaveLength(4);
  });

  test("a row nobody has revised answers a null marker, not an error", async () => {
    await db.insert(observations).values({
      id: "OBS-003",
      workstreamId: WS,
      reporterId: OWNER,
      content: "never corrected",
    });
    const detail = (await query(
      { kind: "OBSERVATION_DETAIL", id: "OBS-003" },
      { db, principal: { id: OWNER }, scope },
    )) as { revision: unknown };
    expect(detail.revision).toBeNull();
  });
});

describe("PROBLEM_SHOW", () => {
  test("the revision marker joins the wave rather than costing a hop after it", async () => {
    const id = await seedProblem();
    await db.insert(revisions).values({
      id: "REV-001",
      entity: "problem",
      entityId: String(id),
      changed: JSON.stringify({ title: "slow reads" }),
      revisedById: OWNER,
      revisedAt: Date.now(),
    });

    const counted = countingD1(env.DB);
    const shown = (await query(
      { kind: "PROBLEM_SHOW", id },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    // The marker is answered, and answered alongside the other two rather than
    // after them: history is a side record, and a `show` pays one statement for
    // knowing it exists (ADR-0017).
    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(3);
    // Five, three deep: the scope check, then the Attempts, the Outcome and
    // the marker together, then the follow-up Problems the Outcome names.
    expect(counted.statements).toHaveLength(5);
  });
});

describe("OBSERVATION_SHOW", () => {
  test("the revision marker joins the wave rather than costing a hop after it", async () => {
    await db.insert(observations).values({
      id: "OBS-001",
      workstreamId: WS,
      reporterId: OWNER,
      content: "the digest takes 12 seconds",
    });
    await db.insert(revisions).values({
      id: "REV-001",
      entity: "observation",
      entityId: "OBS-001",
      changed: JSON.stringify({ content: "the digest takes 4 seconds" }),
      revisedById: OWNER,
      revisedAt: Date.now(),
    });

    const counted = countingD1(env.DB);
    const shown = (await query(
      { kind: "OBSERVATION_SHOW", id: "OBS-001" },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    // The row and the marker together — two statements, one deep. The scope
    // check here is the row itself, so there is no third.
    expect(counted.statements).toHaveLength(2);
    expect(counted.peakConcurrency()).toBe(2);
  });
});

describe("the other reads that carry a marker", () => {
  /** One revision against `entity`/`entityId`, so every marker below is non-null. */
  async function seedRevision(entity: string, entityId: string): Promise<void> {
    await db.insert(revisions).values({
      id: `REV-${entity}`,
      entity,
      entityId,
      changed: JSON.stringify({ title: "what it used to say" }),
      revisedById: OWNER,
      revisedAt: Date.now(),
    });
  }

  test("WORKSTREAM_SHOW issues the marker alongside the row, not after it", async () => {
    await seedRevision("workstream", WS);

    const counted = countingD1(env.DB);
    const shown = (await query(
      { kind: "WORKSTREAM_SHOW", id: WS },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    // The marker keys on the id the caller named, so it never waited on the row.
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(2);
    expect(counted.statements).toHaveLength(2);
  });

  test("ABANDONMENT_SHOW does the same", async () => {
    const id = await seedProblem();
    await db.insert(abandonments).values({
      id: `ABN-${id}`,
      problemId: id,
      rationale: "gave up",
      abandonedById: OWNER,
    });
    await seedRevision("abandonment", `ABN-${id}`);

    const counted = countingD1(env.DB);
    const shown = (await query(
      { kind: "ABANDONMENT_SHOW", id: `ABN-${id}` },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null };

    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(2);
  });

  test("OUTCOME_SHOW puts the marker in the wave the follow-ups already ride", async () => {
    // `seedProblem` is what files OUT-1, so the Outcome exists to be shown.
    await seedProblem();
    await seedRevision("outcome", "OUT-1");

    const counted = countingD1(env.DB);
    const shown = (await query(
      { kind: "OUTCOME_SHOW", id: "OUT-1" },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { revision: { count: number } | null; followUpProblemIds: number[] };

    expect(shown.revision).toEqual({ count: 1, lastRevisedAt: expect.any(Number) });
    expect(shown.followUpProblemIds).toEqual([]);
    // The row first — it is what the scope check needs — then the follow-ups
    // and the marker together.
    expect(counted.peakConcurrency()).toBeGreaterThanOrEqual(2);
    expect(counted.statements).toHaveLength(3);
  });

  test("EVIDENCE_LIST pays one statement for the whole listing's markers", async () => {
    const id = await seedProblem();
    await db.insert(observations).values({
      id: "OBS-2",
      workstreamId: WS,
      content: "another signal",
      reporterId: OWNER,
    });
    await db.insert(evidence).values({
      id: "EVD-2",
      problemId: id,
      observationId: "OBS-2",
      note: "why also",
      createdById: OWNER,
    });
    await seedRevision("evidence", "EVD-1");

    const counted = countingD1(env.DB);
    const rows = (await query(
      { kind: "EVIDENCE_LIST", problem: id },
      { db: counted.db, principal: { id: OWNER }, scope },
    )) as { id: string; revision: { count: number } | null }[];

    expect(rows.map((r) => [r.id, r.revision?.count ?? null])).toEqual([
      ["EVD-1", 1],
      ["EVD-2", null],
    ]);
    // Three: the scope check, the listing, and one grouped marker read for both
    // rows — not one per row (ADR-0017).
    expect(counted.statements).toHaveLength(3);
  });
});
