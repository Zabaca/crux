import { inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { runBatch, type CruxDb } from "../db/client.js";
import { eliminations, eliminationSolutions, solutions } from "../db/schema.js";
import { InvariantError, ReferentialError } from "./errors.js";

export interface CreateEliminationInput {
  id: string; // ELIM-###
  problemId: number;
  eliminatedSolutionIds: ReadonlyArray<number>;
  rationale: string;
  context?: string | null;
  eliminatedById: string;
}

/**
 * Insert an Elimination, flip each targeted Solution to `rejected`. Validates
 * that every solution belongs to the problem and is in `proposed|evaluated`.
 */
export async function createElimination(
  input: CreateEliminationInput,
  db: CruxDb,
): Promise<string> {
  if (input.eliminatedSolutionIds.length === 0) {
    throw new InvariantError("Elimination must target at least one Solution", {});
  }
  const rows = await db
    .select({ id: solutions.id, problemId: solutions.problemId, status: solutions.status })
    .from(solutions)
    .where(inArray(solutions.id, [...input.eliminatedSolutionIds]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const sid of input.eliminatedSolutionIds) {
    const row = byId.get(sid);
    if (!row) throw new ReferentialError(`Solution not found: ${sid}`, { solutionId: sid });
    if (row.problemId !== input.problemId) {
      throw new ReferentialError(
        `Solution ${sid} belongs to problem ${row.problemId}, not ${input.problemId}`,
        { solutionId: sid, expectedProblem: input.problemId, actualProblem: row.problemId },
      );
    }
    if (row.status !== "proposed" && row.status !== "evaluated") {
      throw new InvariantError(
        `Solution ${sid} is ${row.status}; can only eliminate proposed|evaluated`,
        { solutionId: sid, status: row.status },
      );
    }
  }

  const now = Date.now();
  const writes: BatchItem<"sqlite">[] = [
    db.insert(eliminations).values({
      id: input.id,
      problemId: input.problemId,
      rationale: input.rationale,
      context: input.context ?? null,
      createdById: input.eliminatedById,
      createdAt: now,
    }),
    ...input.eliminatedSolutionIds.map((sid) =>
      db.insert(eliminationSolutions).values({ eliminationId: input.id, solutionId: sid }),
    ),
    db
      .update(solutions)
      .set({ status: "rejected", updatedAt: now })
      .where(inArray(solutions.id, [...input.eliminatedSolutionIds])),
  ];
  await runBatch(db, writes);
  return input.id;
}
