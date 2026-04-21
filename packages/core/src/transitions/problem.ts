import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { problems, abandonments } from "../db/schema.js";
import { TransitionError, InvariantError, NotFoundError } from "./errors.js";
import { hasDecisionFor, chosenSolutionIsShipped } from "./predicates.js";

async function loadProblem(problemId: string, db: CruxDb) {
  const rows = await db.select().from(problems).where(eq(problems.id, problemId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Problem not found: ${problemId}`, { problemId });
  return row;
}

export async function commitProblem(problemId: string, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  if (p.lifecycleStatus !== "shaping") {
    throw new TransitionError(`Problem ${problemId} cannot commit from ${p.lifecycleStatus}`, {
      problemId,
      from: p.lifecycleStatus,
      to: "committed",
    });
  }
  if (!(await hasDecisionFor(problemId, db))) {
    throw new InvariantError(`Problem ${problemId} has no Decision; cannot commit`, {
      problemId,
      predicate: "hasDecisionFor",
    });
  }
  await db
    .update(problems)
    .set({ lifecycleStatus: "committed", updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function shipProblem(problemId: string, db: CruxDb) {
  const p = await loadProblem(problemId, db);
  if (p.lifecycleStatus !== "shipping") {
    throw new TransitionError(`Problem ${problemId} cannot ship from ${p.lifecycleStatus}`, {
      problemId,
      from: p.lifecycleStatus,
      to: "shipped",
    });
  }
  if (!(await chosenSolutionIsShipped(problemId, db))) {
    throw new InvariantError(`Problem ${problemId} has no shipped Solution`, {
      problemId,
      predicate: "chosenSolutionIsShipped",
    });
  }
  await db
    .update(problems)
    .set({ lifecycleStatus: "shipped", updatedAt: Date.now() })
    .where(eq(problems.id, problemId));
}

export async function abandonProblem(
  problemId: string,
  rationale: string,
  userId: string,
  db: CruxDb,
) {
  const p = await loadProblem(problemId, db);
  if (p.lifecycleStatus === "shipped" || p.lifecycleStatus === "abandoned") {
    throw new TransitionError(
      `Problem ${problemId} is terminal (${p.lifecycleStatus}); cannot abandon`,
      { problemId, from: p.lifecycleStatus },
    );
  }
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
      .set({ lifecycleStatus: "abandoned", updatedAt: now })
      .where(eq(problems.id, problemId));
  });
}
