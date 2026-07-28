import { defineCommand } from "citty";
import { emit, setJsonMode } from "../output.js";
import { api } from "../api-client.js";
import { wsArg, hintCtx } from "../ctx-defaults.js";

const listCmd = defineCommand({
  meta: { name: "list", description: "List abandonments in a workstream." },
  args: {
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = await wsArg();
    hintCtx(wsVal);
    emit(await api().query({ kind: "ABANDONMENT_LIST", workstream: wsVal }));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an abandonment by id." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "ABANDONMENT_SHOW", id: args.id }));
  },
});

export const abandonmentCommand = defineCommand({
  meta: {
    name: "abandonment",
    description: "Problem abandonments (created via `crux problem abandon`).",
  },
  subCommands: { list: listCmd, show: showCmd },
});
