import { defineCommand } from "citty";
import { OkWithIdOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type { AddEliminationPayload } from "@crux/core/actions";
import { api } from "../api-client.js";
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
    const prVal = await problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddEliminationPayload = {
      solutions: asList(args.solutions),
      rationale: args.rationale,
      context: args.context,
    };
    const { result } = await api().dispatch({ kind: "ADD_ELIMINATION", payload });
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
    emit(
      await api().query({
        kind: "ELIMINATION_LIST",
        ...(args.problem ? { problem: args.problem } : {}),
      }),
    );
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an elimination by id, with targeted solutions." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "ELIMINATION_SHOW", id: args.id }));
  },
});

export const eliminationCommand = defineCommand({
  meta: { name: "elimination", description: "Solution eliminations (pruning)." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
