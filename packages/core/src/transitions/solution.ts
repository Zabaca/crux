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
    problemId: number;
    solutionIds: ReadonlyArray<number>;
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
 * Solution being in `chosen` status.
 */
export async function shipSolution(solutionId: number, db: CruxDb): Promise<void> {
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

export async function editSolution(
  solutionId: number,
  updates: { description?: string; title?: string },
  db: CruxDb,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (updates.description !== undefined) set.description = updates.description;
  if (updates.title !== undefined) set.title = updates.title;
  await db.update(solutions).set(set).where(eq(solutions.id, solutionId));
}
