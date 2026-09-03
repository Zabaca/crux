import { defineCommand } from "citty";
import { OkWithIdOutput, RenameOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type { AddWorkstreamPayload, RenameWorkstreamPayload } from "@crux/core/actions";
import { api } from "../api-client.js";
import { requireWorkstream, workstreamArg } from "../require-args.js";

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

export const workstreamCommand = defineCommand({
  meta: { name: "workstream", description: "Workstreams." },
  // There is no `select`. Pointing the human's screen at a Workstream was the
  // only thing it did once nothing resolved a default from view-state, and one
  // shared screen is not something parallel agents can share. Discovery
  // replaces selection: `list` to choose, `-w` to act.
  subCommands: { add: addCmd, list: listCmd, show: showCmd, rename: renameCmd },
});
