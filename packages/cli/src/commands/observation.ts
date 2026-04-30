import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { observations, workstreams } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { ObservationInput, ObservationArchiveInput, OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError, archiveObservation } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

async function resolveWorkstream(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return row;
}

async function nextObsId(): Promise<string> {
  const all = await getDb().select({ id: observations.id }).from(observations);
  const nums = all.map((r) => Number(r.id.replace(/^OBS-/, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `OBS-${String(next).padStart(3, "0")}`;
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
    workstream: { type: "string", required: true, alias: "w" },
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
    const parsed = ObservationInput.parse({
      workstream: args.workstream,
      content: args.content,
      source: args.source,
      sourceType: args["source-type"],
      tags: asTags(args.tag),
    });
    const ws = await resolveWorkstream(parsed.workstream);
    const user = requireUser();
    const id = await nextObsId();
    await getDb()
      .insert(observations)
      .values({
        id,
        workstreamId: ws.id,
        reporterId: user.user.id,
        content: parsed.content,
        source: parsed.source,
        sourceType: parsed.sourceType,
        tags: parsed.tags && parsed.tags.length ? JSON.stringify(parsed.tags) : null,
      });
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List observations in a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
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
    rationale: { type: "string", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = ObservationArchiveInput.parse({
      observationId: args.id,
      rationale: args.rationale,
    });
    const user = requireUser();
    await archiveObservation(parsed.observationId, parsed.rationale, user.user.id, getDb());
    emit(
      { ok: true, id: parsed.observationId },
      OkWithIdOutput,
      `archived ${parsed.observationId}`,
    );
  },
});

export const observationCommand = defineCommand({
  meta: { name: "observation", description: "Observations." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, archive: archiveCmd },
});
