import { beforeEach, describe, expect, test } from "vitest";
import {
  createDecision,
  InvariantError,
  NotFoundError,
  recordOutcome,
  shipSolution,
} from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { addProblem, addSolution, migratedDb, seedBase, TEST_USER } from "../support/fixtures.js";

/** Take a fresh Solution all the way to `shipped` through the public path. */
async function shippedSolution(db: CruxDb, problemId: number, decisionId: string): Promise<number> {
  const id = await addSolution(db, problemId);
  await createDecision(
    {
      id: decisionId,
      problemId,
      chosenSolutionId: id,
      rejectedSolutionIds: [],
      rationale: "picked",
      decidedById: TEST_USER,
    },
    db,
  );
  await shipSolution(id, db);
  return id;
}

describe("recordOutcome", () => {
  let db: CruxDb;
  let problemId: number;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
    problemId = await addProblem(db);
  });

  test("a shipped Solution can record what shipping produced", async () => {
    const solutionId = await shippedSolution(db, problemId, "DEC-020");

    const id = await recordOutcome(
      {
        id: "OUT-001",
        solutionId,
        observedImpact: "queue drained in a day",
        createdById: TEST_USER,
      },
      db,
    );

    expect(id).toBe("OUT-001");
  });

  test("an Outcome cannot be recorded without a shipped Solution", async () => {
    const proposed = await addSolution(db, problemId);

    await expect(
      recordOutcome(
        {
          id: "OUT-002",
          solutionId: proposed,
          observedImpact: "premature",
          createdById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(InvariantError);
  });

  test("a Solution records at most one Outcome", async () => {
    const solutionId = await shippedSolution(db, problemId, "DEC-021");
    await recordOutcome(
      { id: "OUT-003", solutionId, observedImpact: "first", createdById: TEST_USER },
      db,
    );

    await expect(
      recordOutcome(
        { id: "OUT-004", solutionId, observedImpact: "second", createdById: TEST_USER },
        db,
      ),
    ).rejects.toThrow(InvariantError);
  });

  test("an Outcome against a Solution that does not exist is not found", async () => {
    await expect(
      recordOutcome(
        { id: "OUT-005", solutionId: 99999, observedImpact: "ghost", createdById: TEST_USER },
        db,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  test("follow-up Problems are recorded alongside the Outcome", async () => {
    const solutionId = await shippedSolution(db, problemId, "DEC-022");
    const followUp = await addProblem(db, "What shipping taught us");

    const id = await recordOutcome(
      {
        id: "OUT-006",
        solutionId,
        observedImpact: "worked, but slow",
        followUpProblemIds: [followUp],
        createdById: TEST_USER,
      },
      db,
    );

    expect(id).toBe("OUT-006");
    // The Outcome landed with its links; a second attempt still hits the
    // one-Outcome-per-Solution invariant rather than a half-written row.
    await expect(
      recordOutcome(
        { id: "OUT-007", solutionId, observedImpact: "again", createdById: TEST_USER },
        db,
      ),
    ).rejects.toThrow(InvariantError);
  });
});
