import { defineCommand } from "citty";
import { OkWithIdOutput, OkWithStatusOutput } from "@crux/core/validation";
import { emit, setJsonMode, emitError } from "../output.js";
import type {
  AddSolutionPayload,
  ShipSolutionPayload,
  EditSolutionPayload,
} from "@crux/core/actions";
import { api } from "../api-client.js";
import { problemArg, hintCtx } from "../ctx-defaults.js";

type SolutionRow = { id: number; status: string; title: string };

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a solution candidate to a problem." },
  args: {
    problem: { type: "string", required: false, description: "problem id" },
    title: { type: "string", required: true },
    description: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = await problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddSolutionPayload = {
      problem: prVal,
      title: args.title,
      description: args.description,
    };
    const { result } = await api().dispatch({ kind: "ADD_SOLUTION", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: number }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List solutions, optionally filtered by problem id." },
  args: {
    problem: { type: "positional", required: false },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<SolutionRow[]>({
      kind: "SOLUTION_LIST",
      ...(args.problem ? { problem: args.problem } : {}),
    });
    if (args.problem) {
      emit(rows, rows.map((r) => `${r.id}\t${r.status}\t${r.title}`).join("\n") || "(none)");
      return;
    }
    emit(rows);
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a solution by id." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "SOLUTION_SHOW", id: args.id }));
  },
});

const shipCmd = defineCommand({
  meta: { name: "ship", description: "Flip a chosen Solution to shipped." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ShipSolutionPayload = { id: args.id };
    const { result } = await api().dispatch({ kind: "SHIP_SOLUTION", payload });
    emit(result, OkWithStatusOutput, `shipped ${args.id}`);
  },
});

const editCmd = defineCommand({
  meta: { name: "edit", description: "Edit a solution's description or title." },
  args: {
    id: { type: "positional", required: true },
    description: { type: "string" },
    title: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    if (!args.description && !args.title) {
      emitError({ code: "VALIDATION_ERROR", message: "Provide --description or --title" });
      process.exit(1);
    }
    const payload: EditSolutionPayload = {
      solutionId: args.id,
      ...(args.description !== undefined && { description: args.description }),
      ...(args.title !== undefined && { title: args.title }),
    };
    const { result } = await api().dispatch({ kind: "EDIT_SOLUTION", payload });
    emit(result, OkWithIdOutput, `edited ${args.id}`);
  },
});

export const solutionCommand = defineCommand({
  meta: { name: "solution", description: "Solutions." },
  subCommands: {
    add: addCmd,
    list: listCmd,
    show: showCmd,
    ship: shipCmd,
    edit: editCmd,
  },
});
