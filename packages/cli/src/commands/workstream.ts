import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { workstreams } from "@crux/core/db/schema";
import { OkWithIdOutput, RenameOutput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type {
  AddWorkstreamPayload,
  RenameWorkstreamPayload,
  SelectWorkstreamPayload,
} from "@crux/core/actions";
import { wsArg } from "../ctx-defaults.js";

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
    const { result } = await dispatch({ kind: "ADD_WORKSTREAM", payload });
    emit(result, OkWithIdOutput, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all workstreams." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await getDb().select().from(workstreams);
    emit(rows, rows.map((r) => `${r.id}\t${r.title}`).join("\n") || "(none)");
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a workstream by id." },
  args: {
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsId = wsArg();
    const rows = await getDb().select().from(workstreams).where(eq(workstreams.id, wsId)).limit(1);
    if (rows.length === 0) throw new NotFoundError(`workstream not found: ${wsId}`, { id: wsId });
    emit(rows[0]!, `${rows[0]!.id}\t${rows[0]!.title}`);
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
    const { result } = await dispatch({ kind: "RENAME_WORKSTREAM", payload });
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
    const rows = await getDb()
      .select()
      .from(workstreams)
      .where(eq(workstreams.slug, args.slug))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`workstream not found: ${args.slug}`, { id: args.slug });
    const id = rows[0]!.id;
    const payload: SelectWorkstreamPayload = { id };
    const { viewState, revision } = await dispatch({ kind: "SELECT_WORKSTREAM", payload });
    emit({ ok: true, value: viewState, revision, context: { workstreamId: id } }, `selected ${id}`);
  },
});

export const workstreamCommand = defineCommand({
  meta: { name: "workstream", description: "Workstreams." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, rename: renameCmd, select: selectCmd },
});
