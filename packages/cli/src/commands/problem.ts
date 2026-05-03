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
import { OkWithStatusOutput, ProblemShowOutput, RoadmapTier } from "@crux/core/validation";
import { NotFoundError } from "@crux/core/transitions";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { dispatch } from "@crux/core/actions";
import type {
  AddProblemPayload,
  ScheduleProblemPayload,
  UnscheduleProblemPayload,
  MarkProblemDonePayload,
  AbandonProblemPayload,
} from "@crux/core/actions";
import { recordQuery } from "../record-query.js";
import { wsArg, hintCtx } from "../ctx-defaults.js";

async function resolveWorkstream(id: string) {
  const rows = await getDb().select().from(workstreams).where(eq(workstreams.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`workstream not found: ${id}`, { id });
  return row;
}

async function resolveProblem(id: string | number) {
  const numId = typeof id === "number" ? id : parseInt(String(id), 10);
  const rows = await getDb().select().from(problems).where(eq(problems.id, numId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`problem not found: ${id}`, { id });
  return row;
}

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a problem to a workstream." },
  args: {
    title: { type: "string", required: true },
    description: { type: "string", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = wsArg();
    hintCtx(wsVal);
    const payload: AddProblemPayload = {
      workstream: wsVal,
      title: args.title,
      description: args.description,
    };
    const { result } = await dispatch({ kind: "ADD_PROBLEM", payload });
    emit(result, `added ${(result as { id: number }).id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List problems in a workstream." },
  args: {
    status: {
      type: "string",
      description: "now | next | later | done | abandoned | unscheduled",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = wsArg();
    hintCtx(wsVal);
    const ws = await resolveWorkstream(wsVal);
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
  meta: { name: "show", description: "Show a problem by id." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    recordQuery("PROBLEM_SHOW", args.id);
    const db = getDb();
    const p = await resolveProblem(args.id);

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
    const followUpsByOutcome = new Map<string, number[]>();
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

    emit(
      { ...p, solutions: solutionsInlined, latest_decision: latestDecisionPayload },
      ProblemShowOutput,
    );
  },
});

const scheduleCmd = defineCommand({
  meta: { name: "schedule", description: "Schedule a problem onto the roadmap." },
  args: {
    id: { type: "positional", required: true },
    tier: { type: "string", required: true, description: "now | next | later" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const tier = RoadmapTier.parse(args.tier);
    const payload: ScheduleProblemPayload = { id: args.id, tier };
    const { result } = await dispatch({ kind: "SCHEDULE_PROBLEM", payload });
    emit(result, OkWithStatusOutput, `scheduled ${args.id} → ${tier}`);
  },
});

const unscheduleCmd = defineCommand({
  meta: { name: "unschedule", description: "Remove a problem from the roadmap (back to null)." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: UnscheduleProblemPayload = { id: args.id };
    const { result } = await dispatch({ kind: "UNSCHEDULE_PROBLEM", payload });
    emit(result, OkWithStatusOutput, `unscheduled ${args.id}`);
  },
});

const doneCmd = defineCommand({
  meta: { name: "done", description: "Mark a problem done (chosen Solution must be shipped)." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: MarkProblemDonePayload = { id: args.id };
    const { result } = await dispatch({ kind: "MARK_PROBLEM_DONE", payload });
    emit(result, OkWithStatusOutput, `done ${args.id}`);
  },
});

const abandonCmd = defineCommand({
  meta: { name: "abandon", description: "Abandon a problem (terminal)." },
  args: {
    id: { type: "positional", required: true },
    rationale: { type: "string", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: AbandonProblemPayload = { id: args.id, rationale: args.rationale };
    const { result } = await dispatch({ kind: "ABANDON_PROBLEM", payload });
    emit(result, OkWithStatusOutput, `abandoned ${args.id}`);
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
  },
});
