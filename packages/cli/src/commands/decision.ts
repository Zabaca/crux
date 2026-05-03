import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { decisions, problems, solutions, workstreams } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { DecisionInput, OkWithIdOutput } from "@crux/core/validation";
import { NotFoundError, createDecision } from "@crux/core/transitions";
import { and, eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction, recordMutation } from "../collab.js";
import { wsArg, problemArg, hintCtx } from "../ctx-defaults.js";

async function nextDecisionId(): Promise<string> {
  const all = await getDb().select({ id: decisions.id }).from(decisions);
  const nums = all.map((r) => Number(r.id.replace(/^DEC-/, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `DEC-${String(next).padStart(3, "0")}`;
}

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string")
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

const addCmd = defineCommand({
  meta: {
    name: "add",
    description:
      "Record a decision — flip chosen Solution to chosen, rejected Solutions to rejected.",
  },
  args: {
    problem: { type: "string", required: false },
    chosen: { type: "string", required: true },
    rejected: { type: "string", description: "Repeatable or comma-separated." },
    rationale: { type: "string", required: true },
    context: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = wsArg();
    const prVal = problemArg(args.problem);
    guardAction("ADD_DECISION");
    hintCtx(wsVal, prVal);
    const parsed = DecisionInput.parse({
      workstream: wsVal,
      problemId: prVal,
      chosen: args.chosen,
      rejected: asList(args.rejected),
      rationale: args.rationale,
      context: args.context,
    });
    const user = requireUser();
    const db = getDb();
    const wsById = await db
      .select()
      .from(workstreams)
      .where(eq(workstreams.id, parsed.workstream))
      .limit(1);
    const wsBySlug =
      wsById.length === 0
        ? await db
            .select()
            .from(workstreams)
            .where(eq(workstreams.slug, parsed.workstream))
            .limit(1)
        : [];
    const ws = wsById.length > 0 ? wsById : wsBySlug;
    if (ws.length === 0)
      throw new NotFoundError(`workstream not found: ${parsed.workstream}`, {
        id: parsed.workstream,
      });
    const numProbId =
      typeof parsed.problemId === "number"
        ? parsed.problemId
        : parseInt(String(parsed.problemId), 10);
    const pr = await db
      .select()
      .from(problems)
      .where(and(eq(problems.id, numProbId), eq(problems.workstreamId, ws[0]!.id)))
      .limit(1);
    if (pr.length === 0)
      throw new NotFoundError(`problem not found in workstream: ${parsed.problemId}`, {
        id: parsed.problemId,
      });

    const numChosenId =
      typeof parsed.chosen === "number" ? parsed.chosen : parseInt(String(parsed.chosen), 10);
    const chosenRow = await db
      .select()
      .from(solutions)
      .where(eq(solutions.id, numChosenId))
      .limit(1);
    if (chosenRow.length === 0)
      throw new NotFoundError(`solution not found: ${parsed.chosen}`, { id: parsed.chosen });

    const rejectedIds: number[] = [];
    if (parsed.rejected.length) {
      const solsInProblem = await db
        .select()
        .from(solutions)
        .where(eq(solutions.problemId, pr[0]!.id));
      const solIdSet = new Set(solsInProblem.map((r) => r.id));
      for (const rid of parsed.rejected) {
        const numRid = typeof rid === "number" ? rid : parseInt(String(rid), 10);
        if (!solIdSet.has(numRid))
          throw new NotFoundError(`solution not found in problem: ${rid}`, { id: rid });
        rejectedIds.push(numRid);
      }
    }

    const id = await nextDecisionId();
    await createDecision(
      {
        id,
        problemId: pr[0]!.id,
        chosenSolutionId: chosenRow[0]!.id,
        rejectedSolutionIds: rejectedIds,
        rationale: parsed.rationale,
        context: parsed.context,
        decidedById: user.user.id,
      },
      db,
    );
    recordMutation("ADD_DECISION");
    emit({ ok: true, id }, OkWithIdOutput, `added ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List all decisions." },
  args: { json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    emit(await getDb().select().from(decisions));
  },
});

export const decisionCommand = defineCommand({
  meta: { name: "decision", description: "Decisions." },
  subCommands: { add: addCmd, list: listCmd },
});
