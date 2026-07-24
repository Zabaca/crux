import { beforeEach, describe, expect, test } from "vitest";
import { shipSolution, solutionInStatus, TransitionError } from "../../src/transitions/index.js";
import type { CruxDb } from "../../src/db/client.js";
import { addProblem, addSolution, migratedDb, seedBase } from "../support/fixtures.js";

describe("shipSolution", () => {
  let db: CruxDb;
  let problemId: number;

  beforeEach(async () => {
    db = await migratedDb();
    await seedBase(db);
    problemId = await addProblem(db);
  });

  test("a chosen Solution ships", async () => {
    const id = await addSolution(db, problemId, { status: "chosen" });

    await shipSolution(id, db);

    expect(await solutionInStatus(id, ["shipped"], db)).toBe(true);
  });

  test("a proposed Solution cannot ship — only `chosen` may", async () => {
    const id = await addSolution(db, problemId, { status: "proposed" });

    await expect(shipSolution(id, db)).rejects.toThrow(TransitionError);
    expect(await solutionInStatus(id, ["proposed"], db)).toBe(true);
  });
});
