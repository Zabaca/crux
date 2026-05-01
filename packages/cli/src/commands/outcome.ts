import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { outcomeFollowUpProblems, outcomes, problems, solutions } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { OutcomeInput, OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError, recordOutcome } from "@crux/core/transitions";
import { eq, inArray } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction, recordMutation } from "../collab.js";

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

async function nextOutcomeId(): Promise<string> {
  const all = await getDb().select({ id: outcomes.id }).from(outcomes);
  const nums = all.map((r) => Number(r.id.replace(/^OUT-/, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `OUT-${String(next).padStart(3, "0")}`;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Record an outcome for a shipped Solution." },
  args: {
    solution: { type: "string", required: true, description: "solution slug" },
    "observed-impact": { type: "string", required: true },
    "expected-impact": { type: "string" },
    learnings: { type: "string" },
    "follow-up-problems": { type: "string", description: "comma-separated problem slugs" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    guardAction("ADD_OUTCOME");
    const parsed = OutcomeInput.parse({
      solutionSlug: args.solution,
      observedImpact: args["observed-impact"],
      expectedImpact: args["expected-impact"],
      learnings: args.learnings,
      followUpProblems: asList(args["follow-up-problems"]),
    });
    const db = getDb();
    const sol = await db
      .select()
      .from(solutions)
      .where(eq(solutions.slug, parsed.solutionSlug))
      .limit(1);
    if (sol.length === 0)
      throw new NotFoundError(`solution not found: ${parsed.solutionSlug}`, {
        slug: parsed.solutionSlug,
      });
    let followUpProblemIds: string[] = [];
    if (parsed.followUpProblems && parsed.followUpProblems.length > 0) {
      const rows = await db
        .select()
        .from(problems)
        .where(inArray(problems.slug, parsed.followUpProblems));
      const bySlug = new Map(rows.map((r) => [r.slug, r.id]));
      for (const s of parsed.followUpProblems) {
        const id = bySlug.get(s);
        if (!id) throw new NotFoundError(`follow-up problem not found: ${s}`, { slug: s });
        followUpProblemIds.push(id);
      }
    }
    const user = requireUser();
    const id = await nextOutcomeId();
    await recordOutcome(
      {
        id,
        solutionId: sol[0]!.id,
        observedImpact: parsed.observedImpact,
        expectedImpact: parsed.expectedImpact,
        learnings: parsed.learnings,
        followUpProblemIds,
        createdById: user.user.id,
      },
      db,
    );
    recordMutation("ADD_OUTCOME");
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all outcomes." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await getDb().select().from(outcomes));
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show an outcome by id with follow-up problems." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const rows = await db.select().from(outcomes).where(eq(outcomes.id, args.id)).limit(1);
    if (rows.length === 0)
      throw new NotFoundError(`outcome not found: ${args.id}`, { id: args.id });
    const followUps = await db
      .select({ problemId: outcomeFollowUpProblems.problemId })
      .from(outcomeFollowUpProblems)
      .where(eq(outcomeFollowUpProblems.outcomeId, args.id));
    emit({ ...rows[0]!, followUpProblemIds: followUps.map((f) => f.problemId) });
  },
});

export const outcomeCommand = defineCommand({
  meta: { name: "outcome", description: "Outcomes for shipped Solutions." },
  subCommands: { add: addCmd, list: listCmd, show: showCmd },
});
