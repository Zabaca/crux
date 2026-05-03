import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { problems, solutions } from "@crux/core/db/schema";
import { OkWithIdOutput, OkWithStatusOutput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode, emitError } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type {
  AddSolutionPayload,
  ShipSolutionPayload,
  EditSolutionPayload,
} from "@crux/core/actions";
import { problemArg, hintCtx } from "../ctx-defaults.js";

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
    const prVal = problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddSolutionPayload = {
      problem: prVal,
      title: args.title,
      description: args.description,
    };
    const { result } = await dispatch({ kind: "ADD_SOLUTION", payload });
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
    const db = getDb();
    if (args.problem) {
      const numId = parseInt(String(args.problem), 10);
      const pr = await db.select().from(problems).where(eq(problems.id, numId)).limit(1);
      if (pr.length === 0)
        throw new NotFoundError(`problem not found: ${args.problem}`, { id: args.problem });
      const rows = await db.select().from(solutions).where(eq(solutions.problemId, pr[0]!.id));
      emit(rows, rows.map((r) => `${r.id}\t${r.status}\t${r.title}`).join("\n") || "(none)");
      return;
    }
    emit(await db.select().from(solutions));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a solution by id." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const numId = parseInt(String(args.id), 10);
    const rows = await getDb().select().from(solutions).where(eq(solutions.id, numId)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`solution not found: ${args.id}`, { id: args.id });
    emit(rows[0]!);
  },
});

const shipCmd = defineCommand({
  meta: { name: "ship", description: "Flip a chosen Solution to shipped." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ShipSolutionPayload = { id: args.id };
    const { result } = await dispatch({ kind: "SHIP_SOLUTION", payload });
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
    const { result } = await dispatch({ kind: "EDIT_SOLUTION", payload });
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
