import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  abandonProblem,
  createDecision,
  InvariantError,
  markProblemDone,
  NotFoundError,
  scheduleProblem,
  shipSolution,
  TransitionError,
  unscheduleProblem,
} from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { problems } from "../../src/db/schema.js";
import { addProblem, addSolution, migratedDb, seedBase, TEST_USER } from "../support/fixtures.js";

async function statusOf(db: CruxDb, problemId: number): Promise<string | null> {
  const rows = await db
    .select({ status: problems.status })
    .from(problems)
    .where(eq(problems.id, problemId))
    .limit(1);
  return rows[0]!.status;
}

async function shipASolution(db: CruxDb, problemId: number, decisionId: string): Promise<void> {
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
}

describe("Problem lifecycle", () => {
  let db: CruxDb;
  let problemId: number;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
    problemId = await addProblem(db);
  });

  test("a Problem starts unscheduled and can be moved onto the roadmap", async () => {
    expect(await statusOf(db, problemId)).toBe(null);

    await scheduleProblem(problemId, "next", db);
    expect(await statusOf(db, problemId)).toBe("next");

    await unscheduleProblem(problemId, db);
    expect(await statusOf(db, problemId)).toBe(null);
  });

  test("a Problem is not done until one of its Solutions has shipped", async () => {
    await expect(markProblemDone(problemId, db)).rejects.toThrow(InvariantError);
    expect(await statusOf(db, problemId)).toBe(null);

    await shipASolution(db, problemId, "DEC-030");
    await markProblemDone(problemId, db);

    expect(await statusOf(db, problemId)).toBe("done");
  });

  test("a done Problem is terminal — it cannot be rescheduled or abandoned", async () => {
    await shipASolution(db, problemId, "DEC-031");
    await markProblemDone(problemId, db);

    await expect(scheduleProblem(problemId, "now", db)).rejects.toThrow(TransitionError);
    await expect(abandonProblem(problemId, "changed my mind", TEST_USER, db)).rejects.toThrow(
      TransitionError,
    );
    expect(await statusOf(db, problemId)).toBe("done");
  });

  test("abandoning a Problem is terminal and keeps the reason", async () => {
    await abandonProblem(problemId, "the market moved", TEST_USER, db);

    expect(await statusOf(db, problemId)).toBe("abandoned");
    await expect(abandonProblem(problemId, "again", TEST_USER, db)).rejects.toThrow(
      TransitionError,
    );
  });

  test("a Problem that does not exist is not found", async () => {
    await expect(scheduleProblem(99999, "now", db)).rejects.toThrow(NotFoundError);
  });
});
