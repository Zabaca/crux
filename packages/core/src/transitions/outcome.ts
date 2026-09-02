import { eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { runBatch, type CruxDb } from "../db/client.js";
import { outcomes, outcomeFollowUpProblems, problems } from "../db/schema.js";
import { ReferentialError } from "./errors.js";
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
 *
 * Follow-ups are resolved before the write: a follow-up that does not exist, or
 * that belongs to another Workstream, is a `REFERENTIAL_MISMATCH` rather than a
 * raw batch failure or a dangling link on the Problem page.
 */
export async function recordOutcome(input: RecordOutcomeInput, db: CruxDb): Promise<string> {
  const problem = await requireOpenProblem(input.problemId, "record an Outcome", db);

  const followUpIds = [...new Set(input.followUpProblemIds ?? [])];
  if (followUpIds.length) {
    const found = await db
      .select({ id: problems.id, workstreamId: problems.workstreamId })
      .from(problems)
      .where(inArray(problems.id, followUpIds));
    const byId = new Map(found.map((r) => [r.id, r]));
    for (const pid of followUpIds) {
      if (pid === input.problemId) {
        throw new ReferentialError(`Problem ${pid} cannot be its own follow-up`, {
          problemId: pid,
        });
      }
      const row = byId.get(pid);
      if (!row) throw new ReferentialError(`Problem not found: ${pid}`, { problemId: pid });
      if (row.workstreamId !== problem.workstreamId) {
        throw new ReferentialError(
          `Follow-up Problem ${pid} belongs to ${row.workstreamId}, not ${problem.workstreamId}`,
          { problemId: pid, expected: problem.workstreamId, actual: row.workstreamId },
        );
      }
    }
  }

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
    ...followUpIds.map((pid) =>
      db.insert(outcomeFollowUpProblems).values({ outcomeId: input.id, problemId: pid }),
    ),
    db
      .update(problems)
      .set({ status: "done", updatedAt: now })
      .where(eq(problems.id, input.problemId)),
  ] satisfies BatchItem<"sqlite">[]);
  return input.id;
}
