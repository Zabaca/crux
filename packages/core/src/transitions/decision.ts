import { eq, inArray } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { decisions, decisionRejectedSolutions, solutions } from "../db/schema.js";
import { InvariantError, ReferentialError } from "./errors.js";

export interface CreateDecisionInput {
  id: string; // e.g. DEC-001
  problemId: string;
  chosenSolutionId: string;
  rejectedSolutionIds: ReadonlyArray<string>;
  rationale: string;
  context?: string | null;
  decidedById: string;
  supersedesDecisionId?: string | null;
}

/**
 * Insert a Decision, flip the chosen Solution to `chosen`, flip each
 * rejected Solution to `rejected`. All-or-nothing.
 */
export async function createDecision(input: CreateDecisionInput, db: CruxDb): Promise<string> {
  const {
    id,
    problemId,
    chosenSolutionId,
    rejectedSolutionIds,
    rationale,
    context = null,
    decidedById,
    supersedesDecisionId = null,
  } = input;

  if (rejectedSolutionIds.includes(chosenSolutionId)) {
    throw new InvariantError(
      `Chosen Solution ${chosenSolutionId} also appears in rejected list`,
      { chosenSolutionId },
    );
  }

  const allIds = [chosenSolutionId, ...rejectedSolutionIds];
  const found = await db
    .select({ id: solutions.id, problemId: solutions.problemId, status: solutions.status })
    .from(solutions)
    .where(inArray(solutions.id, allIds));

  const byId = new Map(found.map((r) => [r.id, r]));
  for (const sid of allIds) {
    const row = byId.get(sid);
    if (!row) {
      throw new ReferentialError(`Solution not found: ${sid}`, { solutionId: sid });
    }
    if (row.problemId !== problemId) {
      throw new ReferentialError(
        `Solution ${sid} belongs to problem ${row.problemId}, not ${problemId}`,
        { solutionId: sid, expectedProblem: problemId, actualProblem: row.problemId },
      );
    }
  }

  const chosen = byId.get(chosenSolutionId)!;
  if (chosen.status !== "proposed" && chosen.status !== "evaluated") {
    throw new InvariantError(
      `Chosen Solution ${chosenSolutionId} is ${chosen.status}, must be proposed|evaluated`,
      { solutionId: chosenSolutionId, status: chosen.status },
    );
  }

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(decisions).values({
      id,
      problemId,
      chosenSolutionId,
      rationale,
      context,
      decidedById,
      supersedesDecisionId,
      createdAt: now,
    });
    for (const sid of rejectedSolutionIds) {
      await tx.insert(decisionRejectedSolutions).values({ decisionId: id, solutionId: sid });
    }
    await tx
      .update(solutions)
      .set({ status: "chosen", updatedAt: now })
      .where(eq(solutions.id, chosenSolutionId));
    if (rejectedSolutionIds.length > 0) {
      await tx
        .update(solutions)
        .set({ status: "rejected", updatedAt: now })
        .where(inArray(solutions.id, [...rejectedSolutionIds]));
    }
  });

  return id;
}
