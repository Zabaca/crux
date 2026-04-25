import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { problems, workstreams } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { ProblemInput } from "@crux/core/validation";
import {
  abandonProblem,
  commitProblem,
  NotFoundError,
  renameProblem,
  shipProblem,
} from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

async function resolveWorkstream(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return row;
}

async function resolveProblem(slug: string) {
  const rows = await getDb().select().from(problems).where(eq(problems.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`problem not found: ${slug}`, { slug });
  return row;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a problem to a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string", required: true },
    priority: { type: "string", description: "P0 | P1 | P2 | P3" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = ProblemInput.parse({
      workstream: args.workstream,
      slug: args.slug,
      title: args.title,
      description: args.description,
      priorityTier: args.priority,
    });
    const ws = await resolveWorkstream(parsed.workstream);
    const user = requireUser();
    const id = `PRB-${parsed.slug}`;
    await getDb().insert(problems).values({
      id,
      slug: parsed.slug,
      workstreamId: ws.id,
      title: parsed.title,
      description: parsed.description,
      priorityTier: parsed.priorityTier,
      createdById: user.user.id,
    });
    emit({ ok: true, id }, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List problems in a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
    const rows = await getDb().select().from(problems).where(eq(problems.workstreamId, ws.id));
    emit(rows, rows.map((r) => `${r.id}\t${r.lifecycleStatus}\t${r.title}`).join("\n") || "(none)");
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a problem by slug." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await resolveProblem(args.slug));
  },
});

const commitCmd = defineCommand({
  meta: { name: "commit", description: "Commit a problem (requires a Decision)." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const p = await resolveProblem(args.slug);
    await commitProblem(p.id, getDb());
    emit({ ok: true, id: p.id, lifecycleStatus: "committed" }, `committed ${p.id}`);
  },
});

const shipCmd = defineCommand({
  meta: { name: "ship", description: "Ship a problem (chosen Solution must be shipped)." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const p = await resolveProblem(args.slug);
    await shipProblem(p.id, getDb());
    emit({ ok: true, id: p.id, lifecycleStatus: "shipped" }, `shipped ${p.id}`);
  },
});

const abandonCmd = defineCommand({
  meta: { name: "abandon", description: "Abandon a problem (terminal)." },
  args: {
    slug: { type: "positional", required: true },
    rationale: { type: "string", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const user = requireUser();
    const p = await resolveProblem(args.slug);
    await abandonProblem(p.id, args.rationale, user.user.id, getDb());
    emit({ ok: true, id: p.id, lifecycleStatus: "abandoned" }, `abandoned ${p.id}`);
  },
});

const renameCmd = defineCommand({
  meta: {
    name: "rename",
    description: "Rename a problem slug (cascades to all FK referrers).",
  },
  args: {
    oldSlug: { type: "positional", required: true, description: "Current slug" },
    newSlug: { type: "positional", required: true, description: "New slug" },
    title: { type: "string" },
    description: { type: "string" },
    priority: { type: "string", description: "P0 | P1 | P2 | P3" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const r = await renameProblem(
      args.oldSlug,
      args.newSlug,
      { title: args.title, description: args.description, priorityTier: args.priority },
      getDb(),
    );
    emit({ ok: true, ...r }, `renamed ${r.oldId} → ${r.newId}`);
  },
});

export const problemCommand = defineCommand({
  meta: { name: "problem", description: "Problems." },
  subCommands: {
    add: addCmd,
    list: listCmd,
    show: showCmd,
    commit: commitCmd,
    ship: shipCmd,
    abandon: abandonCmd,
    rename: renameCmd,
  },
});
