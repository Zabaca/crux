import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { runBatch, type CruxDb } from "../db/client.js";
import { outcomes, outcomeFollowUpProblems, problems } from "../db/schema.js";
import { requireOpenProblem } from "./problem.js";

export interface RecordOutcomeInput {
  id: string; // OUT-###
  problemId: number;
  observedImpact: string;
  learnings?: string | null;
  followUpProblemIds?: ReadonlyArray<number>;
  createdById: string;
}

/**
 * Record the Outcome of a Problem — the door to `done`.
 *
 * Writing the row and marking the Problem done is one batch, the same shape
 * `abandonProblem` has: a Problem only ever leaves the board through a
 * transition that carries a reason (ADR-0012).
 *
 * That batch is also what keeps a Problem to one Outcome: recording one makes
 * the Problem terminal, so the second attempt is refused before it can write.
 * The unique index on `problem_id` is the schema-level backstop.
 */
export async function recordOutcome(input: RecordOutcomeInput, db: CruxDb): Promise<string> {
  await requireOpenProblem(input.problemId, "record an Outcome for", db);

  const now = Date.now();
  await runBatch(db, [
    db.insert(outcomes).values({
      id: input.id,
      problemId: input.problemId,
      observedImpact: input.observedImpact,
      learnings: input.learnings ?? null,
      recordedById: input.createdById,
      observedAt: now,
    }),
    ...(input.followUpProblemIds ?? []).map((pid) =>
      db.insert(outcomeFollowUpProblems).values({ outcomeId: input.id, problemId: pid }),
    ),
    db
      .update(problems)
      .set({ status: "done", updatedAt: now })
      .where(eq(problems.id, input.problemId)),
  ] satisfies BatchItem<"sqlite">[]);
  return input.id;
}
