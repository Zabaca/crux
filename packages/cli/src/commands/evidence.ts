import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { evidence, observations, problems } from "@crux/core/db/schema";
import { requireUser } from "@crux/core/config";
import { NotFoundError } from "@crux/core/transitions";
import { OkWithIdOutput } from "@crux/core/validation";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";
import { guardAction, recordMutation } from "../collab.js";
import { problemArg, hintCtx } from "../ctx-defaults.js";

async function nextEvidenceId(): Promise<string> {
  const all = await getDb().select({ id: evidence.id }).from(evidence);
  const nums = all.map((r) => Number(r.id.replace(/^EVD-/, ""))).filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `EVD-${String(next).padStart(3, "0")}`;
}

const linkCmd = defineCommand({
  meta: { name: "link", description: "Link an observation to a problem as evidence." },
  args: {
    observation: { type: "positional", required: true, description: "OBS-###" },
    problem: { type: "positional", required: false, description: "problem id" },
    note: { type: "string" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const prVal = problemArg(args.problem);
    guardAction("ADD_EVIDENCE");
    hintCtx(undefined, prVal);
    const user = requireUser();
    const db = getDb();
    const obs = await db
      .select()
      .from(observations)
      .where(eq(observations.id, args.observation))
      .limit(1);
    if (obs.length === 0)
      throw new NotFoundError(`observation not found: ${args.observation}`, {
        id: args.observation,
      });
    const pr = await db.select().from(problems).where(eq(problems.id, prVal)).limit(1);
    if (pr.length === 0) throw new NotFoundError(`problem not found: ${prVal}`, { id: prVal });
    const id = await nextEvidenceId();
    await db.insert(evidence).values({
      id,
      observationId: args.observation,
      problemId: pr[0]!.id,
      note: args.note,
      createdById: user.user.id,
    });
    recordMutation("ADD_EVIDENCE");
    emit({ ok: true, id }, OkWithIdOutput, `linked ${id}`);
  },
});

const listCmd = defineCommand({
  meta: { name: "list", description: "List evidence, optionally filtered by problem id." },
  args: {
    problem: { type: "positional", required: false },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const db = getDb();
    if (args.problem) {
      const pr = await db.select().from(problems).where(eq(problems.id, args.problem)).limit(1);
      if (pr.length === 0)
        throw new NotFoundError(`problem not found: ${args.problem}`, { id: args.problem });
      emit(await db.select().from(evidence).where(eq(evidence.problemId, pr[0]!.id)));
      return;
    }
    emit(await db.select().from(evidence));
  },
});

export const evidenceCommand = defineCommand({
  meta: { name: "evidence", description: "Evidence links." },
  subCommands: { link: linkCmd, list: listCmd },
});
