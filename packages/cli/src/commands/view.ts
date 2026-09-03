import { defineCommand } from "citty";
import { formatStateValue } from "@crux/core/view-state";
import { emit, setJsonMode } from "../output.js";
import { ViewStateOutput, ViewPathOutput } from "@crux/core/validation";
import { api } from "../api-client.js";

type ViewPayload = {
  value: unknown;
  context: Record<string, unknown>;
  revision: number;
  lastAction: unknown;
  allowedActions: string[];
  globalActions: string[];
};

const getCmd = defineCommand({
  meta: {
    name: "get",
    description: "Print what the human is looking at. Never a source of defaults.",
  },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const view = await api().get<ViewPayload>("/v1/view");
    const payload = {
      value: view.value,
      context: view.context,
      revision: view.revision,
      lastAction: view.lastAction,
      allowedActions: view.allowedActions,
      globalActions: view.globalActions,
    };
    emit(
      payload,
      ViewStateOutput,
      `${formatStateValue(view.value as never)}\t${JSON.stringify(view.context)}`,
    );
  },
});

const pathCmd = defineCommand({
  meta: {
    name: "path",
    // View-state lives in a per-user Durable Object, not a file, so the honest
    // answer to "where is it" is the endpoint that serves it.
    description: "Print the endpoint serving this user's view state.",
  },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const path = `${api().baseUrl}/v1/view`;
    emit({ path }, ViewPathOutput, path);
  },
});

// The view belongs to the human. An agent may read what they are looking at;
// moving them is not on offer — several agents steering one screen is the same
// collision the explicit `-w` was introduced to close, relocated to the screen.
export const viewCommand = defineCommand({
  meta: { name: "view", description: "Read the human's current view. Read-only." },
  subCommands: {
    get: getCmd,
    path: pathCmd,
  },
});
