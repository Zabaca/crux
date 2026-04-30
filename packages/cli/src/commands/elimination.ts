import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { eliminations, eliminationSolutions, problems, solutions } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { EliminationInput, OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError, createElimination } from "@crux/core/transitions";
import { eq, inArray } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

async function nextEliminationId(): Promise<string> {
  const all = await getDb().select({ id: eliminations.id }).from(eliminations);
  const nums = all.map((r) => Number(r.id.replace(/^ELIM-/, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `ELIM-${String(next).padStart(3, "0")}`;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Eliminate one or more Solutions from a Problem." },
  args: {
    problem: { type: "string", required: true },
    solutions: { type: "string", required: true, description: "comma-separated solution slugs" },
    rationale: { type: "string", required: true },
    context: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = EliminationInput.parse({
      problemSlug: args.problem,
      solutions: asList(args.solutions),
      rationale: args.rationale,
      context: args.context,
    });
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
    const solRows = await db
      .select()
      .from(solutions)
      .where(inArray(solutions.slug, parsed.solutions));
    const bySlug = new Map(solRows.map((r) => [r.slug, r]));
    const solutionIds: string[] = [];
    for (const s of parsed.solutions) {
      const row = bySlug.get(s);
      if (!row) throw new NotFoundError(`solution not found: ${s}`, { slug: s });
      solutionIds.push(row.id);
    }
    const user = requireUser();
    const id = await nextEliminationId();
    await createElimination(
      {
        id,
        problemId: pr[0]!.id,
        eliminatedSolutionIds: solutionIds,
        rationale: parsed.rationale,
        context: parsed.context,
        eliminatedById: user.user.id,
      },
      db,
    );
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List eliminations, optionally filtered by problem." },
  args: {
    problem: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    if (args.problem) {
      const pr = await db.select().from(problems).where(eq(problems.slug, args.problem)).limit(1);
      if (pr.length === 0)
        throw new NotFoundError(`problem not found: ${args.problem}`, { slug: args.problem });
      emit(await db.select().from(eliminations).where(eq(eliminations.problemId, pr[0]!.id)));
      return;
    }
    emit(await db.select().from(eliminations));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an elimination by id, with targeted solutions." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const rows = await db.select().from(eliminations).where(eq(eliminations.id, args.id)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`elimination not found: ${args.id}`, { id: args.id });
    const joins = await db
      .select({ solutionId: eliminationSolutions.solutionId })
      .from(eliminationSolutions)
      .where(eq(eliminationSolutions.eliminationId, args.id));
    emit({ ...rows[0]!, eliminatedSolutionIds: joins.map((j) => j.solutionId) });
  },
});

export const eliminationCommand = defineCommand({
  meta: { name: "elimination", description: "Solution eliminations (pruning)." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
