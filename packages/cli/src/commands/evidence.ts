import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { evidence, problems } from "@crux/core/db/schema";
import { NotFoundError } from "@crux/core/transitions";
import { OkWithIdOutput } from "@crux/core/validation";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type { AddEvidencePayload } from "@crux/core/actions";
import { problemArg, hintCtx } from "../ctx-defaults.js";

const linkCmd = defineCommand({
  meta: { name: "link", description: "Link an observation to a problem as evidence." },
  args: {
    observation: { type: "positional", required: true, description: "OBS-###" },
    problem: { type: "positional", required: false, description: "problem id" },
    note: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddEvidencePayload = {
      observation: args.observation,
      problem: prVal,
      note: args.note,
    };
    const { result } = await dispatch({ kind: "ADD_EVIDENCE", payload });
    emit(result, OkWithIdOutput, `linked ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List evidence, optionally filtered by problem id." },
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
      emit(await db.select().from(evidence).where(eq(evidence.problemId, pr[0]!.id)));
      return;
    }
    emit(await db.select().from(evidence));
  },
});

export const evidenceCommand = defineCommand({
  meta: { name: "evidence", description: "Evidence links." },
  subCommands: { link: linkCmd, list: listCmd },
});
