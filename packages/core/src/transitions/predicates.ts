import { and, eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { decisions, solutions } from "../db/schema.js";

export async function hasDecisionFor(problemId: string, db: CruxDb): Promise<boolean> {
  const row = await db
    .select({ id: decisions.id })
    .from(decisions)
    .where(eq(decisions.problemId, problemId))
    .limit(1);
  return row.length > 0;
}

export async function chosenSolutionIsShipped(problemId: string, db: CruxDb): Promise<boolean> {
  const rows = await db
    .select({ status: solutions.status })
    .from(solutions)
    .where(and(eq(solutions.problemId, problemId), eq(solutions.status, "shipped")))
    .limit(1);
  return rows.length > 0;
}

export async function solutionBelongsToProblem(
  solutionId: string,
  problemId: string,
  db: CruxDb,
): Promise<boolean> {
  const rows = await db
    .select({ id: solutions.id })
    .from(solutions)
    .where(and(eq(solutions.id, solutionId), eq(solutions.problemId, problemId)))
    .limit(1);
  return rows.length > 0;
}

export async function solutionInStatus(
  solutionId: string,
  allowed: ReadonlyArray<string>,
  db: CruxDb,
): Promise<boolean> {
  const rows = await db
    .select({ status: solutions.status })
    .from(solutions)
    .where(eq(solutions.id, solutionId))
    .limit(1);
  const status = rows[0]?.status;
  return status !== undefined && allowed.includes(status);
}
