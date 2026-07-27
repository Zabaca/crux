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
  meta: { name: "get", description: "Print current view state." },
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

const nextCmd = defineCommand({
  meta: {
    name: "next",
    description: "Print legal events from the current state.",
  },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload = await api().get<{
      value: unknown;
      events: Array<{ type: string; payload: unknown }>;
    }>("/v1/view/next");
    const text = payload.events.length
      ? payload.events
          .map((e) => `${e.type}${e.payload ? `  ${JSON.stringify(e.payload)}` : "  (no payload)"}`)
          .join("\n")
      : "(none)";
    emit(payload, ViewStateOutput, text);
  },
});

const resetCmd = defineCommand({
  meta: { name: "reset", description: "Reset view state to initial." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload = await api().post<{ ok: true; value: unknown; context: unknown }>(
      "/v1/view/reset",
    );
    emit(payload, ViewStateOutput, `reset → ${formatStateValue(payload.value as never)}`);
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

export const viewCommand = defineCommand({
  meta: { name: "view", description: "Inspect and drive the view-control bus." },
  subCommands: {
    get: getCmd,
    next: nextCmd,
    reset: resetCmd,
    path: pathCmd,
  },
});
