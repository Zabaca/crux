import { beforeEach, describe, expect, test } from "vitest";
import {
  createDecision,
  hasDecisionFor,
  InvariantError,
  ReferentialError,
  solutionInStatus,
} from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { addProblem, addSolution, migratedDb, seedBase, TEST_USER } from "../support/fixtures.js";

describe("createDecision", () => {
  let db: CruxDb;
  let problemId: number;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
    problemId = await addProblem(db);
  });

  test("commits the chosen Solution and records the losers", async () => {
    const chosen = await addSolution(db, problemId, { title: "Ship it" });
    const loser = await addSolution(db, problemId, { title: "Do nothing" });

    await createDecision(
      {
        id: "DEC-001",
        problemId,
        chosenSolutionId: chosen,
        rejectedSolutionIds: [loser],
        rationale: "cheapest path",
        decidedById: TEST_USER,
      },
      db,
    );

    expect(await hasDecisionFor(problemId, db)).toBe(true);
    expect(await solutionInStatus(chosen, ["chosen"], db)).toBe(true);
    expect(await solutionInStatus(loser, ["rejected"], db)).toBe(true);
  });

  test("a Solution cannot be both chosen and rejected by the same Decision", async () => {
    const s = await addSolution(db, problemId);

    await expect(
      createDecision(
        {
          id: "DEC-002",
          problemId,
          chosenSolutionId: s,
          rejectedSolutionIds: [s],
          rationale: "nonsense",
          decidedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(InvariantError);

    expect(await hasDecisionFor(problemId, db)).toBe(false);
    expect(await solutionInStatus(s, ["proposed"], db)).toBe(true);
  });

  test("a Decision cannot choose a Solution belonging to another Problem", async () => {
    const otherProblem = await addProblem(db, "Elsewhere");
    const foreign = await addSolution(db, otherProblem);

    await expect(
      createDecision(
        {
          id: "DEC-003",
          problemId,
          chosenSolutionId: foreign,
          rejectedSolutionIds: [],
          rationale: "wrong problem",
          decidedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(ReferentialError);

    expect(await hasDecisionFor(problemId, db)).toBe(false);
  });

  test("you cannot file a Decision against an already-chosen Solution", async () => {
    const chosen = await addSolution(db, problemId);
    await createDecision(
      {
        id: "DEC-004",
        problemId,
        chosenSolutionId: chosen,
        rejectedSolutionIds: [],
        rationale: "first call",
        decidedById: TEST_USER,
      },
      db,
    );

    await expect(
      createDecision(
        {
          id: "DEC-005",
          problemId,
          chosenSolutionId: chosen,
          rejectedSolutionIds: [],
          rationale: "second call",
          decidedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(InvariantError);
  });

  test("the losing Solutions are all recorded, not just the first", async () => {
    const chosen = await addSolution(db, problemId, { title: "winner" });
    const a = await addSolution(db, problemId, { title: "loser a" });
    const b = await addSolution(db, problemId, { title: "loser b" });

    await createDecision(
      {
        id: "DEC-006",
        problemId,
        chosenSolutionId: chosen,
        rejectedSolutionIds: [a, b],
        rationale: "narrowed",
        decidedById: TEST_USER,
      },
      db,
    );

    expect(await solutionInStatus(a, ["rejected"], db)).toBe(true);
    expect(await solutionInStatus(b, ["rejected"], db)).toBe(true);
  });
});
