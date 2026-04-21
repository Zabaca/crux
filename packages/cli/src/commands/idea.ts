import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { ideas, problems, solutions, workstreams } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { IdeaInput, IdeaPromoteInput } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { eq, isNull } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

async function resolveWorkstream(slug: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.slug, slug)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${slug}`, { slug });
  return row;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Record a raw idea — no commitment." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string" },
    tags: { type: "string", description: "Comma-separated." },
    "hypothesized-problem-area": { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = IdeaInput.parse({
      workstream: args.workstream,
      slug: args.slug,
      title: args.title,
      description: args.description,
      tags: asTags(args.tags),
      hypothesizedProblemArea: args["hypothesized-problem-area"],
    });
    const ws = await resolveWorkstream(parsed.workstream);
    const user = requireUser();
    const id = `IDEA-${parsed.slug}`;
    await getDb()
      .insert(ideas)
      .values({
        id,
        slug: parsed.slug,
        workstreamId: ws.id,
        reporterId: user.user.id,
        title: parsed.title,
        description: parsed.description,
        hypothesizedProblemArea: parsed.hypothesizedProblemArea,
        tags: parsed.tags && parsed.tags.length ? JSON.stringify(parsed.tags) : null,
      });
    emit({ ok: true, id }, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: {
    name: "list",
    description: "List ideas in a workstream (unpromoted + archived separated).",
  },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
    const db = getDb();
    const rows = await db.select().from(ideas).where(eq(ideas.workstreamId, ws.id));
    const promotedIds = new Set(
      (await db.select({ ideaId: solutions.originatingIdeaId }).from(solutions))
        .map((r) => r.ideaId)
        .filter((x): x is string => Boolean(x)),
    );
    const unpromoted = rows.filter((r) => !r.archivedAt && !promotedIds.has(r.id));
    const promoted = rows.filter((r) => !r.archivedAt && promotedIds.has(r.id));
    const archived = rows.filter((r) => r.archivedAt);
    emit({ unpromoted, promoted, archived });
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an idea by slug." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await getDb().select().from(ideas).where(eq(ideas.slug, args.slug)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`idea not found: ${args.slug}`, { slug: args.slug });
    emit(rows[0]!);
  },
});

const promoteCmd = defineCommand({
  meta: { name: "promote", description: "Promote an idea into a Solution against a Problem." },
  args: {
    slug: { type: "positional", required: true, description: "idea slug" },
    problem: { type: "string", required: true, description: "problem slug" },
    "solution-slug": { type: "string", description: "Override (default: idea slug)." },
    title: { type: "string", required: true },
    description: { type: "string" },
    effort: { type: "string", description: "S | M | L | XL" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = IdeaPromoteInput.parse({
      ideaSlug: args.slug,
      problemSlug: args.problem,
      solutionSlug: args["solution-slug"] || args.slug,
      title: args.title,
      description: args.description,
      effort: args.effort,
    });
    const db = getDb();
    const ideaRows = await db.select().from(ideas).where(eq(ideas.slug, parsed.ideaSlug)).limit(1);
    if (ideaRows.length === 0)
      throw new NotFoundError(`idea not found: ${parsed.ideaSlug}`, { slug: parsed.ideaSlug });
    const pr = await db
      .select()
      .from(problems)
      .where(eq(problems.slug, parsed.problemSlug))
      .limit(1);
    if (pr.length === 0)
      throw new NotFoundError(`problem not found: ${parsed.problemSlug}`, {
        slug: parsed.problemSlug,
      });
    const user = requireUser();
    const id = `SOL-${parsed.solutionSlug}`;
    await db.insert(solutions).values({
      id,
      slug: parsed.solutionSlug,
      problemId: pr[0]!.id,
      title: parsed.title,
      description: parsed.description,
      effort: parsed.effort,
      originatingIdeaId: ideaRows[0]!.id,
      createdById: user.user.id,
    });
    emit(
      { ok: true, id, originatingIdeaId: ideaRows[0]!.id },
      `promoted ${ideaRows[0]!.id} → ${id}`,
    );
    void isNull;
  },
});

export const ideaCommand = defineCommand({
  meta: { name: "idea", description: "Ideas — raw, uncommitted notes." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, promote: promoteCmd },
});
