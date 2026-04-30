import { defineCommand } from "citty";
import {
  formatStateValue,
  loadState,
  nextEvents,
  resetState,
  resolveViewStatePath,
  sendViewEvent,
  ViewEventRefusedError,
  VIEW_EVENT_PAYLOAD_HINTS,
  type ViewEvent,
} from "@crux/core/view-state";
import { emit, emitError, setJsonMode } from "../output.js";
import { ViewStateOutput, ViewPathOutput } from "@crux/core/validation";

const getCmd = defineCommand({
  meta: { name: "get", description: "Print current view state." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const snap = loadState();
    const payload = { value: snap.value, context: snap.context };
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

const sendCmd = defineCommand({
  meta: {
    name: "send",
    description: "Send an event into the view machine. Fails with non-zero exit if refused.",
  },
  args: {
    event: {
      type: "positional",
      required: true,
      description: "Event type (e.g. SELECT_WORKSTREAM)",
    },
    payload: { type: "string", description: "JSON payload for the event" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    let payload: Record<string, unknown> = {};
    if (args.payload) {
      try {
        payload = JSON.parse(args.payload);
      } catch (e) {
        emitError(
          { ok: false, code: "INVALID_PAYLOAD", message: (e as Error).message },
          `invalid --payload json: ${(e as Error).message}`,
        );
        process.exit(2);
      }
    }
    const event = { type: args.event, ...payload } as ViewEvent;
    try {
      const snap = await sendViewEvent(event);
      emit(
        { ok: true, value: snap.value, context: snap.context },
        ViewStateOutput,
        `${formatStateValue(snap.value)}\t${JSON.stringify(snap.context)}`,
      );
    } catch (e) {
      if (e instanceof ViewEventRefusedError) {
        emitError(
          { ok: false, code: e.code, message: e.message },
          `refused (${e.code}): ${e.message}`,
        );
        process.exit(1);
      }
      throw e;
    }
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
    send: sendCmd,
    next: nextCmd,
    reset: resetCmd,
    path: pathCmd,
  },
});
