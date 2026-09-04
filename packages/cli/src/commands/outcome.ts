import { defineCommand } from "citty";
import { emit, setJsonMode } from "../output.js";
import type { ReviseOutcomePayload } from "@crux/core/actions";
import { api } from "../api-client.js";
import { emitRevised, revisionsCommand } from "../revisions.js";

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

/**
 * Correcting an Outcome (ADR-0017) — a measurement can be retracted, and the
 * history is what keeps that from being a silently different claim. It changes
 * the prose and nothing else: the Problem stays `done`, and it still has the
 * one Outcome it is allowed.
 */
const reviseCmd = defineCommand({
  meta: { name: "revise", description: "Correct an outcome's observed impact or learnings." },
  args: {
    id: { type: "positional", required: true, description: "OUT-###" },
    "observed-impact": { type: "string" },
    learnings: { type: "string" },
    reason: { type: "string", description: "why the correction was made (optional)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const impact = args["observed-impact"];
    const payload: ReviseOutcomePayload = {
      id: args.id,
      ...(impact !== undefined ? { observedImpact: impact } : {}),
      ...(args.learnings !== undefined ? { learnings: args.learnings } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    };
    const { result } = await api().dispatch({ kind: "REVISE_OUTCOME", payload });
    emitRevised(result, args.id);
  },
});

const revisionsCmd = revisionsCommand({
  kind: "OUTCOME_REVISIONS",
  noun: "an outcome",
  idHint: "OUT-###",
});

export const outcomeCommand = defineCommand({
  meta: { name: "outcome", description: "Outcomes — what became of a Problem." },
  subCommands: { list: listCmd, show: showCmd, revise: reviseCmd, revisions: revisionsCmd },
});
