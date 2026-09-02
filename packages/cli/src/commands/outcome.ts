import { defineCommand } from "citty";
import { OkWithStatusOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type { AddOutcomePayload } from "@crux/core/actions";
import { api } from "../api-client.js";

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
  meta: { name: "add", description: "Record a problem's outcome, marking it done." },
  args: {
    problem: { type: "string", required: true, description: "problem id" },
    "observed-impact": { type: "string", required: true },
    learnings: { type: "string" },
    "follow-up-problems": { type: "string", description: "comma-separated problem ids" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: AddOutcomePayload = {
      problem: args.problem,
      observedImpact: args["observed-impact"],
      learnings: args.learnings,
      followUpProblemIds: asList(args["follow-up-problems"]),
    };
    const { result } = await api().dispatch({ kind: "ADD_OUTCOME", payload });
    const { id } = result as { id: string };
    emit(result, OkWithStatusOutput, `added ${id} — problem ${args.problem} is done`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all outcomes." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "OUTCOME_LIST" }));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an outcome by id with follow-up problems." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "OUTCOME_SHOW", id: args.id }));
  },
});

export const outcomeCommand = defineCommand({
  meta: { name: "outcome", description: "Outcomes — what became of a Problem." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
