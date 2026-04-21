import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { solutions, eliminations, eliminationSolutions } from "../db/schema.js";
import { InvariantError, NotFoundError, TransitionError } from "./errors.js";

/**
 * Legacy helper kept for the seed script — prefer `createElimination` from
 * ./elimination.ts for new callers.
 */
export async function eliminateSolutions(
  input: {
    id: string;
    problemId: string;
    solutionIds: ReadonlyArray<string>;
    rationale: string;
    createdById: string;
  },
  db: CruxDb,
): Promise<void> {
  if (input.solutionIds.length === 0) {
    throw new InvariantError("Elimination must target at least one Solution", {});
  }
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(eliminations).values({
      id: input.id,
      problemId: input.problemId,
      rationale: input.rationale,
      createdById: input.createdById,
      createdAt: now,
    });
    for (const sid of input.solutionIds) {
      await tx.insert(eliminationSolutions).values({ eliminationId: input.id, solutionId: sid });
      await tx
        .update(solutions)
        .set({ status: "rejected", updatedAt: now })
        .where(eq(solutions.id, sid));
    }
  });
}

/**
 * Flip a chosen Solution to `shipped`. Simple state transition — gates on the
 * Solution being in `chosen` status. Needed so Outcomes become reachable.
 */
export async function shipSolution(solutionId: string, db: CruxDb): Promise<void> {
  const rows = await db.select().from(solutions).where(eq(solutions.id, solutionId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Solution not found: ${solutionId}`, { solutionId });
  if (row.status !== "chosen") {
    throw new TransitionError(
      `Solution ${solutionId} cannot ship from ${row.status}; must be chosen`,
      { solutionId, from: row.status, to: "shipped" },
    );
  }
  await db
    .update(solutions)
    .set({ status: "shipped", updatedAt: Date.now() })
    .where(eq(solutions.id, solutionId));
}
