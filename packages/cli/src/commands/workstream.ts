import { defineCommand } from "citty";
import { OkWithIdOutput, RenameOutput } from "../validation/index.js";
import { emit, setJsonMode } from "../output.js";
import type {
  AddWorkstreamPayload,
  RenameWorkstreamPayload,
  ReviseWorkstreamPayload,
} from "@crux/core/actions";
import type { RevisionEntry } from "@crux/core/reads";
import { api } from "../api-client.js";
import { requireWorkstream, workstreamArg } from "../require-args.js";
import { formatRevisions } from "../revisions.js";

type WorkstreamRow = { id: string; slug: string; title: string };

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a workstream." },
  args: {
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: AddWorkstreamPayload = {
      slug: args.slug,
      title: args.title,
      description: args.description,
    };
    const { result } = await api().dispatch({ kind: "ADD_WORKSTREAM", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all workstreams." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<WorkstreamRow[]>({ kind: "WORKSTREAM_LIST" });
    emit(rows, rows.map((r) => `${r.id}\t${r.title}`).join("\n") || "(none)");
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a workstream by slug or id." },
  args: {
    ...workstreamArg(),
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const row = await api().query<WorkstreamRow>({
      kind: "WORKSTREAM_SHOW",
      id: requireWorkstream(args.workstream),
    });
    emit(row, `${row.id}\t${row.title}`);
  },
});

const renameCmd = defineCommand({
  meta: {
    name: "rename",
    description: "Rename a workstream slug.",
  },
  args: {
    oldSlug: { type: "positional", required: true, description: "Current slug" },
    newSlug: { type: "positional", required: true, description: "New slug" },
    title: { type: "string" },
    description: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: RenameWorkstreamPayload = {
      oldSlug: args.oldSlug,
      newSlug: args.newSlug,
      title: args.title,
      description: args.description,
    };
    const { result } = await api().dispatch({ kind: "RENAME_WORKSTREAM", payload });
    const renamed = result as { oldSlug: string; newSlug: string };
    emit(result, RenameOutput, `renamed ${renamed.oldSlug} → ${renamed.newSlug}`);
  },
});

/**
 * Correcting a Workstream's title or description (ADR-0017).
 *
 * There is no `--slug`: a slug is how the Workstream is addressed rather than
 * something it said, and `rename` keeps it (ADR-0016). The deployment refuses
 * one too — the payload is `.strict()` — so the two halves agree.
 */
const reviseCmd = defineCommand({
  meta: { name: "revise", description: "Correct a workstream's title or description." },
  args: {
    ...workstreamArg(),
    title: { type: "string" },
    description: { type: "string" },
    reason: { type: "string", description: "why the correction was made (optional)" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: ReviseWorkstreamPayload = {
      workstream: requireWorkstream(args.workstream),
      ...(args.title !== undefined ? { title: args.title } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
    };
    const { result } = await api().dispatch({ kind: "REVISE_WORKSTREAM", payload });
    const { changedFields } = result as { changedFields: string[] };
    emit(result, `revised ${payload.workstream} — ${changedFields.join(", ")}`);
  },
});

const revisionsCmd = defineCommand({
  meta: { name: "revisions", description: "What a workstream used to say." },
  args: { ...workstreamArg(), json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await api().query<RevisionEntry[]>({
      kind: "WORKSTREAM_REVISIONS",
      id: requireWorkstream(args.workstream),
    });
    emit(rows, formatRevisions(rows));
  },
});

export const workstreamCommand = defineCommand({
  meta: { name: "workstream", description: "Workstreams." },
  // There is no `select`. Pointing the human's screen at a Workstream was the
  // only thing it did once nothing resolved a default from view-state, and one
  // shared screen is not something parallel agents can share. Discovery
  // replaces selection: `list` to choose, `-w` to act.
  subCommands: {
    add: addCmd,
    list: listCmd,
    show: showCmd,
    rename: renameCmd,
    revise: reviseCmd,
    revisions: revisionsCmd,
  },
});
