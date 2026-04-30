import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import {
  decisionRejectedSolutions,
  decisions,
  outcomeFollowUpProblems,
  outcomes,
  problems,
  solutions,
  workstreams,
} from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { ProblemInput, RoadmapTier } from "@crux/core/validation";
import {
  abandonProblem,
  markProblemDone,
  NotFoundError,
  renameProblem,
  scheduleProblem,
  unscheduleProblem,
} from "@crux/core/transitions";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = ProblemInput.parse({
      workstream: args.workstream,
      slug: args.slug,
      title: args.title,
      description: args.description,
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
      createdById: user.user.id,
    });
    emit({ ok: true, id }, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List problems in a workstream." },
  args: {
    workstream: { type: "string", required: true, alias: "w" },
    status: {
      type: "string",
      description: "now | next | later | done | abandoned | unscheduled",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const ws = await resolveWorkstream(args.workstream);
    const filter = args.status;
    const where =
      filter === "unscheduled"
        ? and(eq(problems.workstreamId, ws.id), isNull(problems.status))
        : filter
          ? and(eq(problems.workstreamId, ws.id), eq(problems.status, filter))
          : eq(problems.workstreamId, ws.id);
    const rows = await getDb().select().from(problems).where(where);
    emit(
      rows,
      rows.map((r) => `${r.id}\t${r.status ?? "unscheduled"}\t${r.title}`).join("\n") || "(none)",
    );
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show a problem by slug." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    const p = await resolveProblem(args.slug);

    const sols = await db.select().from(solutions).where(eq(solutions.problemId, p.id));
    const solIds = sols.map((s) => s.id);
    const outcomeRows = solIds.length
      ? await db.select().from(outcomes).where(inArray(outcomes.solutionId, solIds))
      : [];
    const outcomeBySol = new Map(outcomeRows.map((o) => [o.solutionId, o]));
    const outcomeIds = outcomeRows.map((o) => o.id);
    const followUps = outcomeIds.length
      ? await db
          .select()
          .from(outcomeFollowUpProblems)
          .where(inArray(outcomeFollowUpProblems.outcomeId, outcomeIds))
      : [];
    const followUpsByOutcome = new Map<string, string[]>();
    for (const f of followUps) {
      const list = followUpsByOutcome.get(f.outcomeId) ?? [];
      list.push(f.problemId);
      followUpsByOutcome.set(f.outcomeId, list);
    }
    const solutionsInlined = sols.map((s) => {
      const outcome = outcomeBySol.get(s.id);
      return {
        ...s,
        outcome: outcome
          ? { ...outcome, followUpProblemIds: followUpsByOutcome.get(outcome.id) ?? [] }
          : null,
      };
    });

    const latestDec = (
      await db
        .select()
        .from(decisions)
        .where(eq(decisions.problemId, p.id))
        .orderBy(desc(decisions.createdAt))
        .limit(1)
    )[0];
    let latestDecisionPayload: unknown = null;
    if (latestDec) {
      const rej = await db
        .select({ solutionId: decisionRejectedSolutions.solutionId })
        .from(decisionRejectedSolutions)
        .where(eq(decisionRejectedSolutions.decisionId, latestDec.id));
      latestDecisionPayload = { ...latestDec, rejectedSolutionIds: rej.map((r) => r.solutionId) };
    }

    emit({ ...p, solutions: solutionsInlined, latest_decision: latestDecisionPayload });
  },
});

const scheduleCmd = defineCommand({
  meta: { name: "schedule", description: "Schedule a problem onto the roadmap." },
  args: {
    slug: { type: "positional", required: true },
    tier: { type: "string", required: true, description: "now | next | later" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const tier = RoadmapTier.parse(args.tier);
    const p = await resolveProblem(args.slug);
    await scheduleProblem(p.id, tier, getDb());
    emit({ ok: true, id: p.id, status: tier }, `scheduled ${p.id} → ${tier}`);
  },
});

const unscheduleCmd = defineCommand({
  meta: { name: "unschedule", description: "Remove a problem from the roadmap (back to null)." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const p = await resolveProblem(args.slug);
    await unscheduleProblem(p.id, getDb());
    emit({ ok: true, id: p.id, status: null }, `unscheduled ${p.id}`);
  },
});

const doneCmd = defineCommand({
  meta: { name: "done", description: "Mark a problem done (chosen Solution must be shipped)." },
  args: { slug: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const p = await resolveProblem(args.slug);
    await markProblemDone(p.id, getDb());
    emit({ ok: true, id: p.id, status: "done" }, `done ${p.id}`);
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
    emit({ ok: true, id: p.id, status: "abandoned" }, `abandoned ${p.id}`);
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
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const r = await renameProblem(
      args.oldSlug,
      args.newSlug,
      { title: args.title, description: args.description },
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
    schedule: scheduleCmd,
    unschedule: unscheduleCmd,
    done: doneCmd,
    abandon: abandonCmd,
    rename: renameCmd,
  },
});
