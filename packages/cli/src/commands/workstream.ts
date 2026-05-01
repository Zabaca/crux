import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { workstreams } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { WorkstreamInput, OkWithIdOutput, RenameOutput } from "@crux/core/validation";
import { NotFoundError, renameWorkstream } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction, recordMutation } from "../collab.js";

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
    guardAction("ADD_WORKSTREAM");
    const parsed = WorkstreamInput.parse({
      slug: args.slug,
      title: args.title,
      description: args.description,
    });
    const user = requireUser();
    const id = `WS-${parsed.slug}`;
    await getDb().insert(workstreams).values({
      id,
      slug: parsed.slug,
      title: parsed.title,
      description: parsed.description,
      ownerId: user.user.id,
    });
    recordMutation("ADD_WORKSTREAM");
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
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
  meta: { name: "show", description: "Show a workstream by slug." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await getDb()
      .select()
      .from(workstreams)
      .where(eq(workstreams.slug, args.workstream))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`workstream not found: ${args.workstream}`, {
        slug: args.workstream,
      });
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
    guardAction("RENAME_WORKSTREAM");
    const r = await renameWorkstream(
      args.oldSlug,
      args.newSlug,
      { title: args.title, description: args.description },
      getDb(),
    );
    recordMutation("RENAME_WORKSTREAM");
    emit({ ok: true, ...r }, RenameOutput, `renamed ${r.oldId} → ${r.newId}`);
  },
});

export const workstreamCommand = defineCommand({
  meta: { name: "workstream", description: "Workstreams." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, rename: renameCmd },
});
