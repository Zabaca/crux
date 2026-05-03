import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { decisions } from "@crux/core/db/schema";
import { OkWithIdOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type { AddDecisionPayload } from "@crux/core/actions";
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
  meta: {
    name: "add",
    description:
      "Record a decision — flip chosen Solution to chosen, rejected Solutions to rejected.",
  },
  args: {
    problem: { type: "string", required: false },
    chosen: { type: "string", required: true },
    rejected: { type: "string", description: "Repeatable or comma-separated." },
    rationale: { type: "string", required: true },
    context: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddDecisionPayload = {
      problem: prVal,
      chosen: args.chosen,
      rationale: args.rationale,
      rejected: asList(args.rejected),
      context: args.context,
    };
    const { result } = await dispatch({ kind: "ADD_DECISION", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all decisions." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await getDb().select().from(decisions));
  },
});

export const decisionCommand = defineCommand({
  meta: { name: "decision", description: "Decisions." },
  subCommands: { add: addCmd, list: listCmd },
});
