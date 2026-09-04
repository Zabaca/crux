import { defineCommand } from "citty";
import { emit, setJsonMode } from "../output.js";
import type { ReviseAbandonmentPayload } from "@crux/core/actions";
import type { RevisionEntry } from "@crux/core/reads";
import { api } from "../api-client.js";
import { formatRevisions } from "../revisions.js";
import { requireWorkstream, workstreamArg } from "../require-args.js";

const listCmd = defineCommand({
  meta: { name: "list", description: "List abandonments in a workstream." },
  args: {
    ...workstreamArg(),
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = requireWorkstream(args.workstream);
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

/**
 * Correcting why a Problem was given up on (ADR-0017). The Problem stays
 * abandoned — this is the rationale, not a route back onto the board.
 */
const reviseCmd = defineCommand({
  meta: { name: "revise", description: "Correct an abandonment's rationale." },
  args: {
    id: { type: "positional", required: true, description: "ABN-<problem-id>" },
    rationale: { type: "string" },
    reason: { type: "string", description: "why the correction was made (optional)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ReviseAbandonmentPayload = {
      id: args.id,
      ...(args.rationale !== undefined ? { rationale: args.rationale } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    };
    const { result } = await api().dispatch({ kind: "REVISE_ABANDONMENT", payload });
    const { changedFields } = result as { changedFields: string[] };
    emit(result, `revised ${args.id} — ${changedFields.join(", ")}`);
  },
});

const revisionsCmd = defineCommand({
  meta: { name: "revisions", description: "What an abandonment used to say." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<RevisionEntry[]>({ kind: "ABANDONMENT_REVISIONS", id: args.id });
    emit(rows, formatRevisions(rows));
  },
});

export const abandonmentCommand = defineCommand({
  meta: {
    name: "abandonment",
    description: "Problem abandonments (created via `crux problem abandon`).",
  },
  subCommands: { list: listCmd, show: showCmd, revise: reviseCmd, revisions: revisionsCmd },
});
