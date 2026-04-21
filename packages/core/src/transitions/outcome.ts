import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { outcomes, outcomeFollowUpProblems, solutions } from "../db/schema.js";
import { InvariantError, ReferentialError, NotFoundError } from "./errors.js";

export interface RecordOutcomeInput {
  id: string; // OUT-###
  solutionId: string;
  observedImpact: string;
  expectedImpact?: string | null;
  learnings?: string | null;
  followUpProblemIds?: ReadonlyArray<string>;
  createdById: string;
}

/**
 * Record an Outcome for a shipped Solution. Enforces:
 * - Solution exists and is in `shipped` status.
 * - One Outcome per Solution (uniqueness on solution_id).
 */
export async function recordOutcome(input: RecordOutcomeInput, db: CruxDb): Promise<string> {
  const solRows = await db
    .select()
    .from(solutions)
    .where(eq(solutions.id, input.solutionId))
    .limit(1);
  const sol = solRows[0];
  if (!sol) throw new NotFoundError(`Solution not found: ${input.solutionId}`, { solutionId: input.solutionId });
  if (sol.status !== "shipped") {
    throw new InvariantError(
      `Cannot record Outcome: Solution ${input.solutionId} is ${sol.status}, must be shipped`,
      { solutionId: input.solutionId, status: sol.status },
    );
  }
  const existing = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .where(eq(outcomes.solutionId, input.solutionId))
    .limit(1);
  if (existing.length > 0) {
    throw new InvariantError(
      `Outcome already recorded for Solution ${input.solutionId} (${existing[0]!.id})`,
      { solutionId: input.solutionId, existingOutcomeId: existing[0]!.id },
    );
  }

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(outcomes).values({
      id: input.id,
      solutionId: input.solutionId,
      observedImpact: input.observedImpact,
      expectedImpact: input.expectedImpact ?? null,
      learnings: input.learnings ?? null,
      recordedById: input.createdById,
      observedAt: now,
    });
    if (input.followUpProblemIds && input.followUpProblemIds.length > 0) {
      for (const pid of input.followUpProblemIds) {
        await tx.insert(outcomeFollowUpProblems).values({ outcomeId: input.id, problemId: pid });
      }
    }
  });
  // silence unused imports
  void ReferentialError;
  return input.id;
}
