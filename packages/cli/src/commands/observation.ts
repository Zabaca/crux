import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { observations, workstreams } from "@crux/core/db/schema";
import { NotFoundError } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type { AddObservationPayload, ArchiveObservationPayload } from "@crux/core/actions";
import { wsArg, hintCtx } from "../ctx-defaults.js";

async function resolveWorkstream(idOrSlug: string) {
  const db = getDb();
  const byId = (
    await db.select().from(workstreams).where(eq(workstreams.id, idOrSlug)).limit(1)
  )[0];
  if (byId) return byId;
  const bySlug = (
    await db.select().from(workstreams).where(eq(workstreams.slug, idOrSlug)).limit(1)
  )[0];
  if (bySlug) return bySlug;
  throw new NotFoundError(`workstream not found: ${idOrSlug}`, { id: idOrSlug });
}

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
    const wsVal = wsArg();
    hintCtx(wsVal);
    const payload: AddObservationPayload = {
      workstream: wsVal,
      content: args.content,
      source: args.source,
      sourceType: args["source-type"],
      tags: asTags(args.tag),
    };
    const { result } = await dispatch({ kind: "ADD_OBSERVATION", payload });
    emit(result, `added ${(result as { id: string }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List observations in a workstream." },
  args: {
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = wsArg();
    hintCtx(wsVal);
    const ws = await resolveWorkstream(wsVal);
    const rows = await getDb()
      .select()
      .from(observations)
      .where(eq(observations.workstreamId, ws.id));
    emit(rows, rows.map((r) => `${r.id}\t${r.content.slice(0, 60)}`).join("\n") || "(none)");
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
    const rows = await getDb()
      .select()
      .from(observations)
      .where(eq(observations.id, args.id))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`observation not found: ${args.id}`, { id: args.id });
    emit(rows[0]!);
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
    const { result } = await dispatch({ kind: "ARCHIVE_OBSERVATION", payload });
    emit(result, `archived ${args.id}`);
  },
});

export const observationCommand = defineCommand({
  meta: { name: "observation", description: "Observations." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, archive: archiveCmd },
});
