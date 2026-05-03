import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { eliminations, eliminationSolutions, problems } from "@crux/core/db/schema";
import { OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type { AddEliminationPayload } from "@crux/core/actions";
import { problemArg, hintCtx } from "../ctx-defaults.js";

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Eliminate one or more Solutions from a Problem." },
  args: {
    problem: { type: "string", required: false },
    solutions: { type: "string", required: true, description: "comma-separated solution ids" },
    rationale: { type: "string", required: true },
    context: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddEliminationPayload = {
      solutions: asList(args.solutions),
      rationale: args.rationale,
      context: args.context,
    };
    const { result } = await dispatch({ kind: "ADD_ELIMINATION", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List eliminations, optionally filtered by problem." },
  args: {
    problem: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    if (args.problem) {
      const numId = parseInt(args.problem, 10);
      const pr = await db.select().from(problems).where(eq(problems.id, numId)).limit(1);
      if (pr.length === 0)
        throw new NotFoundError(`problem not found: ${args.problem}`, { id: args.problem });
      emit(await db.select().from(eliminations).where(eq(eliminations.problemId, pr[0]!.id)));
      return;
    }
    emit(await db.select().from(eliminations));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an elimination by id, with targeted solutions." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const rows = await db.select().from(eliminations).where(eq(eliminations.id, args.id)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`elimination not found: ${args.id}`, { id: args.id });
    const joins = await db
      .select({ solutionId: eliminationSolutions.solutionId })
      .from(eliminationSolutions)
      .where(eq(eliminationSolutions.eliminationId, args.id));
    emit({ ...rows[0]!, eliminatedSolutionIds: joins.map((j) => j.solutionId) });
  },
});

export const eliminationCommand = defineCommand({
  meta: { name: "elimination", description: "Solution eliminations (pruning)." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
