import { defineCommand } from "citty";
import {
  formatStateValue,
  loadState,
  nextEvents,
  resetState,
  resolveViewStatePath,
  VIEW_EVENT_PAYLOAD_HINTS,
  type ViewEvent,
} from "@crux/core/view-state";
import { emit, setJsonMode } from "../output.js";
import { ViewStateOutput, ViewPathOutput } from "@crux/core/validation";
import { loadViewMeta } from "@crux/core/view-state";
import { getAllowedActions } from "@crux/core/actions";

const getCmd = defineCommand({
  meta: { name: "get", description: "Print current view state." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const snap = loadState();
    const meta = loadViewMeta();
    const allowed = getAllowedActions(snap.value);
    const payload = {
      value: snap.value,
      context: snap.context,
      revision: meta.revision,
      lastAction: meta.lastAction,
      allowedActions: [...allowed.allowedView, ...allowed.allowedMutation],
      globalActions: allowed.globals,
    };
    emit(
      payload,
      ViewStateOutput,
      `${formatStateValue(snap.value)}\t${JSON.stringify(snap.context)}`,
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
    const snap = loadState();
    const events = nextEvents(snap);
    const withHints = events.map((type) => ({
      type,
      payload: VIEW_EVENT_PAYLOAD_HINTS[type as ViewEvent["type"]] ?? null,
    }));
    const text = withHints.length
      ? withHints
          .map((e) => `${e.type}${e.payload ? `  ${JSON.stringify(e.payload)}` : "  (no payload)"}`)
          .join("\n")
      : "(none)";
    emit({ value: snap.value, events: withHints }, ViewStateOutput, text);
  },
});

const resetCmd = defineCommand({
  meta: { name: "reset", description: "Reset view state to initial." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const snap = resetState();
    const payload = { ok: true, value: snap.value, context: snap.context };
    emit(payload, ViewStateOutput, `reset → ${formatStateValue(snap.value)}`);
  },
});

const pathCmd = defineCommand({
  meta: { name: "path", description: "Print resolved view-state file path." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const path = resolveViewStatePath();
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
