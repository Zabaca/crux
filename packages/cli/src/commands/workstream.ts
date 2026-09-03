import { defineCommand } from "citty";
import { OkWithIdOutput, RenameOutput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { emit, setJsonMode } from "../output.js";
import type {
  AddWorkstreamPayload,
  RenameWorkstreamPayload,
  SelectWorkstreamPayload,
} from "@crux/core/actions";
import { api } from "../api-client.js";
import { wsArg } from "../resolve-args.js";

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
    workstream: {
      type: "string",
      alias: "w",
      description: "Required. Workstream slug or id — `crux workstream list` shows them.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const row = await api().query<WorkstreamRow>({
      kind: "WORKSTREAM_SHOW",
      id: wsArg(args.workstream),
    });
    emit(row, `${row.id}\t${row.title}`);
  },
});

const renameCmd = defineCommand({
  meta: {
    name: "rename",
    description: "Rename a workstream slug (cascades to all FK referrers).",
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
    emit(
      result,
      RenameOutput,
      `renamed ${(result as { oldId: string; newId: string }).oldId} → ${(result as { oldId: string; newId: string }).newId}`,
    );
  },
});

const selectCmd = defineCommand({
  meta: { name: "select", description: "Select a workstream (sets view state context)." },
  args: {
    slug: { type: "positional", required: true, description: "Workstream slug" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const client = api();
    const row = await client.query<WorkstreamRow | null>({
      kind: "WORKSTREAM_BY_SLUG",
      slug: args.slug,
    });
    if (!row) throw new NotFoundError(`workstream not found: ${args.slug}`, { id: args.slug });
    const payload: SelectWorkstreamPayload = { id: row.id };
    const { viewState, revision } = await client.dispatch({ kind: "SELECT_WORKSTREAM", payload });
    emit(
      { ok: true, value: viewState, revision, context: { workstreamId: row.id } },
      `selected ${row.id}`,
    );
  },
});

export const workstreamCommand = defineCommand({
  meta: { name: "workstream", description: "Workstreams." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, rename: renameCmd, select: selectCmd },
});
