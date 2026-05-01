import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { problems, solutions } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import {
  SolutionInput,
  OkWithIdOutput,
  OkWithStatusOutput,
  RenameOutput,
} from "@crux/core/validation";
import { NotFoundError, renameSolution, shipSolution } from "@crux/core/transitions";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction } from "../collab.js";

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a solution candidate to a problem." },
  args: {
    problem: { type: "string", required: true, description: "problem slug" },
    slug: { type: "string", required: true },
    title: { type: "string", required: true },
    description: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("ADD_SOLUTION");
    const parsed = SolutionInput.parse({
      problemSlug: args.problem,
      slug: args.slug,
      title: args.title,
      description: args.description,
    });
    const user = requireUser();
    const db = getDb();
    const pr = await db
      .select()
      .from(problems)
      .where(eq(problems.slug, parsed.problemSlug))
      .limit(1);
    if (pr.length === 0)
      throw new NotFoundError(`problem not found: ${parsed.problemSlug}`, {
        slug: parsed.problemSlug,
      });
    const id = `SOL-${parsed.slug}`;
    await db.insert(solutions).values({
      id,
      slug: parsed.slug,
      problemId: pr[0]!.id,
      title: parsed.title,
      description: parsed.description,
      createdById: user.user.id,
    });
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List solutions, optionally filtered by problem slug." },
  args: {
    problem: { type: "positional", required: false },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    if (args.problem) {
      const pr = await db.select().from(problems).where(eq(problems.slug, args.problem)).limit(1);
      if (pr.length === 0)
        throw new NotFoundError(`problem not found: ${args.problem}`, { slug: args.problem });
      const rows = await db.select().from(solutions).where(eq(solutions.problemId, pr[0]!.id));
      emit(rows, rows.map((r) => `${r.id}\t${r.status}\t${r.title}`).join("\n") || "(none)");
      return;
    }
    emit(await db.select().from(solutions));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a solution by slug." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const rows = await getDb()
      .select()
      .from(solutions)
      .where(eq(solutions.slug, args.slug))
      .limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`solution not found: ${args.slug}`, { slug: args.slug });
    emit(rows[0]!);
  },
});

const shipCmd = defineCommand({
  meta: { name: "ship", description: "Flip a chosen Solution to shipped." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("SHIP_SOLUTION");
    const db = getDb();
    const rows = await db.select().from(solutions).where(eq(solutions.slug, args.slug)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`solution not found: ${args.slug}`, { slug: args.slug });
    await shipSolution(rows[0]!.id, db);
    emit(
      { ok: true, id: rows[0]!.id, status: "shipped" },
      OkWithStatusOutput,
      `shipped ${rows[0]!.id}`,
    );
  },
});

const renameCmd = defineCommand({
  meta: {
    name: "rename",
    description: "Rename a solution slug (cascades to all FK referrers).",
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
    guardAction("RENAME_SOLUTION");
    const r = await renameSolution(
      args.oldSlug,
      args.newSlug,
      { title: args.title, description: args.description },
      getDb(),
    );
    emit({ ok: true, ...r }, RenameOutput, `renamed ${r.oldId} → ${r.newId}`);
  },
});

export const solutionCommand = defineCommand({
  meta: { name: "solution", description: "Solutions." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd, ship: shipCmd, rename: renameCmd },
});
