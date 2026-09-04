import { defineCommand } from "citty";
import { emit, setJsonMode } from "../output.js";
import type { AddObservationPayload, ArchiveObservationPayload } from "@crux/core/actions";
import { api } from "../api-client.js";
import { requireWorkstream, workstreamArg } from "../require-args.js";

type ObservationRow = {
  id: string;
  content: string;
  archive?: { rationale: string | null } | null;
};

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Record a new observation." },
  args: {
    ...workstreamArg(),
    content: { type: "string", required: true },
    source: { type: "string" },
    "source-type": {
      type: "string",
      description: "internal | competitive | external | analysis | customer_report | metric_signal",
    },
    tag: { type: "string", description: "Repeatable or comma-separated." },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = requireWorkstream(args.workstream);
    const payload: AddObservationPayload = {
      workstream: wsVal,
      content: args.content,
      source: args.source,
      sourceType: args["source-type"],
      tags: asTags(args.tag),
    };
    const { result } = await api().dispatch({ kind: "ADD_OBSERVATION", payload });
    emit(result, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List observations in a workstream." },
  args: {
    ...workstreamArg(),
    unlinked: {
      type: "boolean",
      description:
        "Only Observations not yet linked to a Problem — the review queue. " +
        "Rows carry an `archive` block and come back newest first.",
    },
    "show-archived": {
      type: "boolean",
      description:
        "Include archived Observations. Without it — the default — a row that " +
        "has been archived is left out of the listing entirely; it stays " +
        "reachable by id and under any Problem's Evidence.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = requireWorkstream(args.workstream);
    const rows = await api().query<ObservationRow[]>(
      args.unlinked
        ? {
            kind: "OBSERVATION_UNLINKED",
            workstreamId: wsVal,
            showArchived: Boolean(args["show-archived"]),
          }
        : {
            kind: "OBSERVATION_LIST",
            workstream: wsVal,
            showArchived: Boolean(args["show-archived"]),
          },
    );
    emit(
      rows,
      rows
        .map(
          (r) =>
            `${r.id}\t${r.content.slice(0, 60)}` +
            // Only ever present when the reader asked for archived rows, and
            // the rationale is the reason they asked.
            (r.archive ? `\t[archived — ${r.archive.rationale ?? "no rationale recorded"}]` : ""),
        )
        .join("\n") || "(none)",
    );
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show one observation by id." },
  args: {
    id: { type: "positional", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await api().query({ kind: "OBSERVATION_SHOW", id: args.id }));
  },
});

const archiveCmd = defineCommand({
  meta: {
    name: "archive",
    description: "Archive an observation with a rationale (terminal, no un-archive).",
  },
  args: {
    id: { type: "positional", required: true },
    rationale: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ArchiveObservationPayload = {
      id: args.id,
      rationale: args.rationale,
    };
    const { result } = await api().dispatch({ kind: "ARCHIVE_OBSERVATION", payload });
    emit(result, `archived ${args.id}`);
  },
});

export const observationCommand = defineCommand({
  meta: { name: "observation", description: "Observations." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, archive: archiveCmd },
});
