import { defineCommand } from "citty";
import { OkWithIdOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type { AddEvidencePayload } from "@crux/core/actions";
import { api } from "../api-client.js";
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
    const prVal = await problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddEvidencePayload = {
      observation: args.observation,
      problem: prVal,
      note: args.note,
    };
    const { result } = await api().dispatch({ kind: "ADD_EVIDENCE", payload });
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
    emit(
      await api().query({
        kind: "EVIDENCE_LIST",
        ...(args.problem ? { problem: args.problem } : {}),
      }),
    );
  },
});

export const evidenceCommand = defineCommand({
  meta: { name: "evidence", description: "Evidence links." },
  subCommands: { link: linkCmd, list: listCmd },
});
