import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { problems, abandonments } from "../db/schema.js";
import { TransitionError, InvariantError, NotFoundError } from "./errors.js";
import { chosenSolutionIsShipped } from "./predicates.js";

export type RoadmapTier = "now" | "next" | "later";

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

export async function scheduleProblem(problemId: number, tier: RoadmapTier, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  assertNotTerminal(p, "reschedule");
  await db
    .update(problems)
    .set({ status: tier, updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function unscheduleProblem(problemId: number, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  assertNotTerminal(p, "unschedule");
  await db
    .update(problems)
    .set({ status: null, updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function markProblemDone(problemId: number, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  assertNotTerminal(p, "mark done");
  if (!(await chosenSolutionIsShipped(problemId, db))) {
    throw new InvariantError(`Problem ${problemId} has no shipped Solution`, {
      problemId,
      predicate: "chosenSolutionIsShipped",
    });
  }
  await db
    .update(problems)
    .set({ status: "done", updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function abandonProblem(
  problemId: number,
  rationale: string,
  userId: string,
  db: CruxDb,
) {
  const p = await loadProblem(problemId, db);
  assertNotTerminal(p, "abandon");
  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx.insert(abandonments).values({
      id: `ABN-${problemId}`,
      problemId,
      rationale,
      abandonedById: userId,
      abandonedAt: now,
    });
    await tx
      .update(problems)
      .set({ status: "abandoned", updatedAt: now })
      .where(eq(problems.id, problemId));
  });
}
