import { defineCommand } from "citty";
import { OkWithIdOutput, OkWithStatusOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type { AddAttemptPayload, CloseAttemptPayload } from "@crux/core/actions";
import { api } from "../api-client.js";
import { problemArg, wsArg, hintCtx } from "../ctx-defaults.js";

type AttemptRow = {
  id: string;
  status: string;
  label: string;
  ref: string;
  closingNote: string | null;
};

type DriftingProblemRow = {
  id: number;
  status: string | null;
  title: string;
  attemptCount: number;
};

const addCmd = defineCommand({
  meta: {
    name: "add",
    description: "Record that work about a Problem is happening in another tracker.",
  },
  args: {
    problem: { type: "string", required: false, description: "problem id" },
    ref: { type: "string", required: true, description: "where the work actually lives" },
    label: { type: "string", required: true, description: "a short label" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = await problemArg(args.problem);
    hintCtx(undefined, prVal);
    const payload: AddAttemptPayload = { problem: prVal, ref: args.ref, label: args.label };
    const { result } = await api().dispatch({ kind: "ADD_ATTEMPT", payload });
    emit(result, OkWithIdOutput, `recorded ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List Attempts, optionally filtered by problem id." },
  args: {
    problem: { type: "positional", required: false },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<AttemptRow[]>({
      kind: "ATTEMPT_LIST",
      ...(args.problem ? { problem: args.problem } : {}),
    });
    emit(
      rows,
      rows.map((r) => `${r.id}\t${r.status}\t${r.label}\t${r.ref}`).join("\n") || "(none)",
    );
  },
});

const closeCmd = defineCommand({
  meta: {
    name: "close",
    description: "Close an Attempt as shipped or dropped, with why it ended that way.",
  },
  args: {
    id: { type: "positional", required: true },
    status: { type: "string", required: true, description: "shipped | dropped" },
    note: { type: "string", required: true, description: "why it ended that way" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    // `status` is left as the server sees it: the enum lives in the action
    // schema, so a typo comes back as the same VALIDATION_ERROR every other
    // client gets rather than as a second copy of the rule here.
    const payload = {
      id: args.id,
      status: args.status,
      closingNote: args.note,
    } as CloseAttemptPayload;
    const { result } = await api().dispatch({ kind: "CLOSE_ATTEMPT", payload });
    emit(result, OkWithStatusOutput, `closed ${args.id} → ${args.status}`);
  },
});

const driftCmd = defineCommand({
  meta: {
    name: "drift",
    description: "Problems staged as active with no open Attempt against them.",
  },
  args: {
    stage: {
      type: "string",
      description: "comma-separated stages to treat as active (default: now)",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = await wsArg();
    hintCtx(wsVal);
    const stages = args.stage
      ? args.stage
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const rows = await api().query<DriftingProblemRow[]>({
      kind: "PROBLEM_DRIFT",
      workstream: wsVal,
      ...(stages ? { stages } : {}),
    });
    emit(
      rows,
      rows
        .map((r) => `${r.id}\t${r.status ?? "unscheduled"}\t${r.attemptCount} attempts\t${r.title}`)
        .join("\n") || "(none)",
    );
  },
});

export const attemptCommand = defineCommand({
  meta: { name: "attempt", description: "Attempts — work happening in another tracker." },
  subCommands: {
    add: addCmd,
    list: listCmd,
    close: closeCmd,
    drift: driftCmd,
  },
});
