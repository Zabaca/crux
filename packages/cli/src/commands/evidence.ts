import { defineCommand } from "citty";
import { OkWithIdOutput } from "../validation/index.js";
import { emit, setJsonMode } from "../output.js";
import type { AddEvidencePayload, ReviseEvidencePayload } from "@crux/core/actions";
import type { RevisionEntry } from "@crux/core/reads";
import { api } from "../api-client.js";
import { requireProblem } from "../require-args.js";
import { formatRevisions } from "../revisions.js";

const linkCmd = defineCommand({
  meta: { name: "link", description: "Link an observation to a problem as evidence." },
  args: {
    observation: { type: "positional", required: true, description: "OBS-###" },
    problem: {
      type: "positional",
      required: false,
      description: "Required. Problem id — `crux problem list -w <slug>` shows them.",
    },
    note: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = requireProblem(args.problem, "<problem-id>");
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

/**
 * Correcting the why-note (ADR-0017). The link itself is not touchable here:
 * which Observation supports which Problem is an assertion, not a sentence.
 */
const reviseCmd = defineCommand({
  meta: { name: "revise", description: "Correct an evidence link's note." },
  args: {
    id: { type: "positional", required: true, description: "EVD-###" },
    note: { type: "string" },
    reason: { type: "string", description: "why the correction was made (optional)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ReviseEvidencePayload = {
      id: args.id,
      ...(args.note !== undefined ? { note: args.note } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    };
    const { result } = await api().dispatch({ kind: "REVISE_EVIDENCE", payload });
    const { changedFields } = result as { changedFields: string[] };
    emit(result, `revised ${args.id} — ${changedFields.join(", ")}`);
  },
});

const revisionsCmd = defineCommand({
  meta: { name: "revisions", description: "What an evidence link used to say." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<RevisionEntry[]>({ kind: "EVIDENCE_REVISIONS", id: args.id });
    emit(rows, formatRevisions(rows));
  },
});

export const evidenceCommand = defineCommand({
  meta: { name: "evidence", description: "Evidence links." },
  subCommands: { link: linkCmd, list: listCmd, revise: reviseCmd, revisions: revisionsCmd },
});
