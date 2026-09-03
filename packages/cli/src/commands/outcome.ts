import { defineCommand } from "citty";
import { emit, setJsonMode } from "../output.js";
import { api } from "../api-client.js";

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
  subCommands: { list: listCmd, show: showCmd },
});
