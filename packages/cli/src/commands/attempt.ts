import { defineCommand } from "citty";
import { OkWithIdOutput, OkWithStatusOutput } from "../validation/index.js";
import { emit, setJsonMode } from "../output.js";
import type {
  AddAttemptPayload,
  CloseAttemptPayload,
  ReviseAttemptPayload,
} from "@crux/core/actions";
import type { RevisionEntry } from "@crux/core/reads";
import { formatRevisions } from "../revisions.js";
import { api } from "../api-client.js";
import { requireProblem, requireWorkstream, workstreamArg } from "../require-args.js";

type AttemptRow = {
  id: string;
  status: string;
  label: string;
  ref: string;
  closingNote: string | null;
  revision: { count: number; lastRevisedAt: number } | null;
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
    problem: {
      type: "string",
      required: false,
      description: "Required. Problem id — `crux problem list -w <slug>` shows them.",
    },
    ref: { type: "string", required: true, description: "where the work actually lives" },
    label: { type: "string", required: true, description: "a short label" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = requireProblem(args.problem, "--problem <id>");
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
      rows
        .map(
          (r) =>
            `${r.id}\t${r.status}\t${r.label}\t${r.ref}` +
            // A marker and nothing else: what the row used to say is
            // `attempt revisions <id>` (ADR-0017).
            (r.revision ? `\t[revised ×${r.revision.count}]` : ""),
        )
        .join("\n") || "(none)",
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

/**
 * Correcting an Attempt (ADR-0017). Only the flags given are sent, and none of
 * them is `status`: getting a `ref` wrong used to cost a terminal transition —
 * close it `dropped` and refile — and a correction is not a transition.
 */
const reviseCmd = defineCommand({
  meta: { name: "revise", description: "Correct an Attempt's ref, label, or closing note." },
  args: {
    id: { type: "positional", required: true },
    ref: { type: "string", description: "where the work actually lives" },
    label: { type: "string", description: "a short label" },
    note: { type: "string", description: "the closing note — only on an Attempt that has one" },
    reason: { type: "string", description: "why the correction was made (optional)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ReviseAttemptPayload = {
      id: args.id,
      ...(args.ref !== undefined ? { ref: args.ref } : {}),
      ...(args.label !== undefined ? { label: args.label } : {}),
      ...(args.note !== undefined ? { closingNote: args.note } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    };
    const { result } = await api().dispatch({ kind: "REVISE_ATTEMPT", payload });
    const { changedFields } = result as { changedFields: string[] };
    emit(result, `revised ${args.id} — ${changedFields.join(", ")}`);
  },
});

const revisionsCmd = defineCommand({
  meta: { name: "revisions", description: "What an Attempt used to say." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<RevisionEntry[]>({ kind: "ATTEMPT_REVISIONS", id: args.id });
    emit(rows, formatRevisions(rows));
  },
});

const driftCmd = defineCommand({
  meta: {
    name: "drift",
    description: "Problems staged as active with no open Attempt against them.",
  },
  args: {
    ...workstreamArg(),
    stage: {
      type: "string",
      description: "comma-separated stages to treat as active (default: now)",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = requireWorkstream(args.workstream);
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
    revise: reviseCmd,
    revisions: revisionsCmd,
    drift: driftCmd,
  },
});
