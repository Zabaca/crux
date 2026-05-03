import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { outcomeFollowUpProblems, outcomes } from "@crux/core/db/schema";
import { OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type { AddOutcomePayload } from "@crux/core/actions";

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
  meta: { name: "add", description: "Record an outcome for a shipped Solution." },
  args: {
    solution: { type: "string", required: true, description: "solution id" },
    "observed-impact": { type: "string", required: true },
    "expected-impact": { type: "string" },
    learnings: { type: "string" },
    "follow-up-problems": { type: "string", description: "comma-separated problem ids" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: AddOutcomePayload = {
      solution: args.solution,
      observedImpact: args["observed-impact"],
      expectedImpact: args["expected-impact"],
      learnings: args.learnings,
      followUpProblemIds: asList(args["follow-up-problems"]),
    };
    const { result } = await dispatch({ kind: "ADD_OUTCOME", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all outcomes." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await getDb().select().from(outcomes));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an outcome by id with follow-up problems." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const rows = await db.select().from(outcomes).where(eq(outcomes.id, args.id)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`outcome not found: ${args.id}`, { id: args.id });
    const followUps = await db
      .select({ problemId: outcomeFollowUpProblems.problemId })
      .from(outcomeFollowUpProblems)
      .where(eq(outcomeFollowUpProblems.outcomeId, args.id));
    emit({ ...rows[0]!, followUpProblemIds: followUps.map((f) => f.problemId) });
  },
});

export const outcomeCommand = defineCommand({
  meta: { name: "outcome", description: "Outcomes for shipped Solutions." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
