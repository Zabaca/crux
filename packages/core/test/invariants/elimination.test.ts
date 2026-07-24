import { beforeEach, describe, expect, test } from "vitest";
import {
  createDecision,
  createElimination,
  eliminateSolutions,
  hasDecisionFor,
  InvariantError,
  ReferentialError,
  shipSolution,
  solutionInStatus,
} from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { addProblem, addSolution, migratedDb, seedBase, TEST_USER } from "../support/fixtures.js";

describe("createElimination", () => {
  let db: CruxDb;
  let problemId: number;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
    problemId = await addProblem(db);
  });

  test("rejects the named Solutions without committing to a winner", async () => {
    const out = await addSolution(db, problemId, { title: "too slow" });
    const survivor = await addSolution(db, problemId, { title: "still in play" });

    await createElimination(
      {
        id: "ELIM-001",
        problemId,
        eliminatedSolutionIds: [out],
        rationale: "too slow",
        eliminatedById: TEST_USER,
      },
      db,
    );

    expect(await solutionInStatus(out, ["rejected"], db)).toBe(true);
    expect(await solutionInStatus(survivor, ["proposed"], db)).toBe(true);
    // Progressive narrowing: an Elimination is a "no" with no winner.
    expect(await hasDecisionFor(problemId, db)).toBe(false);
  });

  test("an Elimination must target at least one Solution", async () => {
    await expect(
      createElimination(
        {
          id: "ELIM-002",
          problemId,
          eliminatedSolutionIds: [],
          rationale: "nothing to say",
          eliminatedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(InvariantError);
  });

  test("a shipped Solution cannot be eliminated", async () => {
    const shipped = await addSolution(db, problemId, { title: "already out the door" });
    await createDecision(
      {
        id: "DEC-010",
        problemId,
        chosenSolutionId: shipped,
        rejectedSolutionIds: [],
        rationale: "picked",
        decidedById: TEST_USER,
      },
      db,
    );
    await shipSolution(shipped, db);

    await expect(
      createElimination(
        {
          id: "ELIM-003",
          problemId,
          eliminatedSolutionIds: [shipped],
          rationale: "too late",
          eliminatedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(InvariantError);

    expect(await solutionInStatus(shipped, ["shipped"], db)).toBe(true);
  });

  test("the legacy eliminateSolutions helper still rejects its targets", async () => {
    const out = await addSolution(db, problemId, { title: "legacy path" });

    await eliminateSolutions(
      {
        id: "ELIM-005",
        problemId,
        solutionIds: [out],
        rationale: "kept for the seed script",
        createdById: TEST_USER,
      },
      db,
    );

    expect(await solutionInStatus(out, ["rejected"], db)).toBe(true);
  });

  test("one bad Solution in the list eliminates none of them", async () => {
    const ours = await addSolution(db, problemId, { title: "ours" });
    const otherProblem = await addProblem(db, "Elsewhere");
    const foreign = await addSolution(db, otherProblem, { title: "theirs" });

    await expect(
      createElimination(
        {
          id: "ELIM-004",
          problemId,
          eliminatedSolutionIds: [ours, foreign],
          rationale: "mixed batch",
          eliminatedById: TEST_USER,
        },
        db,
      ),
    ).rejects.toThrow(ReferentialError);

    expect(await solutionInStatus(ours, ["proposed"], db)).toBe(true);
    expect(await solutionInStatus(foreign, ["proposed"], db)).toBe(true);
  });
});
