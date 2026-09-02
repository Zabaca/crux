import { eq } from "drizzle-orm";
import { runBatch, type CruxDb } from "../db/client.js";
import { problems, abandonments } from "../db/schema.js";
import { TransitionError, NotFoundError } from "./errors.js";

export type RoadmapStage = "now" | "next" | "later";

async function loadProblem(problemId: number, db: CruxDb) {
  const rows = await db.select().from(problems).where(eq(problems.id, problemId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Problem not found: ${problemId}`, { problemId });
  return row;
}

function assertNotTerminal(p: { id: number; status: string | null }, action: string) {
  if (p.status === "done" || p.status === "abandoned") {
    throw new TransitionError(`Problem ${p.id} is terminal (${p.status}); cannot ${action}`, {
      problemId: p.id,
      from: p.status,
    });
  }
}

/**
 * The Problem a transition is about to act on, refused if it is already
 * terminal. Shared with `recordOutcome`, which is the other terminal door.
 */
export async function requireOpenProblem(problemId: number, action: string, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  assertNotTerminal(p, action);
  return p;
}

export async function scheduleProblem(problemId: number, stage: RoadmapStage, db: CruxDb) {
  await requireOpenProblem(problemId, "reschedule", db);
  await db
    .update(problems)
    .set({ status: stage, updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function unscheduleProblem(problemId: number, db: CruxDb) {
  await requireOpenProblem(problemId, "unschedule", db);
  await db
    .update(problems)
    .set({ status: null, updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function abandonProblem(
  problemId: number,
  rationale: string,
  userId: string,
  db: CruxDb,
) {
  await requireOpenProblem(problemId, "abandon", db);
  const now = Date.now();
  await runBatch(db, [
    db.insert(abandonments).values({
      id: `ABN-${problemId}`,
      problemId,
      rationale,
      abandonedById: userId,
      abandonedAt: now,
    }),
    db
      .update(problems)
      .set({ status: "abandoned", updatedAt: now })
      .where(eq(problems.id, problemId)),
  ]);
}
