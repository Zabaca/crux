import { defineCommand } from "citty";
import { OkWithStatusOutput, ProblemShowOutput, RoadmapStage } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import type {
  AddProblemPayload,
  ScheduleProblemPayload,
  UnscheduleProblemPayload,
  AbandonProblemPayload,
} from "@crux/core/actions";
import { api } from "../api-client.js";
import { wsArg, hintCtx } from "../ctx-defaults.js";

type ProblemRow = { id: number; status: string | null; title: string };

const addCmd = defineCommand({
  meta: { name: "add", description: "Add a problem to a workstream." },
  args: {
    title: { type: "string", required: true },
    description: { type: "string", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = await wsArg();
    hintCtx(wsVal);
    const payload: AddProblemPayload = {
      workstream: wsVal,
      title: args.title,
      description: args.description,
    };
    const { result } = await api().dispatch({ kind: "ADD_PROBLEM", payload });
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
    const wsVal = await wsArg();
    hintCtx(wsVal);
    const rows = await api().query<ProblemRow[]>({
      kind: "PROBLEM_LIST",
      workstream: wsVal,
      ...(args.status ? { status: args.status } : {}),
    });
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
    emit(await api().query({ kind: "PROBLEM_SHOW", id: args.id }), ProblemShowOutput);
  },
});

const scheduleCmd = defineCommand({
  meta: { name: "schedule", description: "Schedule a problem onto the roadmap." },
  args: {
    id: { type: "positional", required: true },
    stage: { type: "string", required: true, description: "now | next | later" },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const stage = RoadmapStage.parse(args.stage);
    const payload: ScheduleProblemPayload = { id: args.id, stage };
    const { result } = await api().dispatch({ kind: "SCHEDULE_PROBLEM", payload });
    emit(result, OkWithStatusOutput, `scheduled ${args.id} → ${stage}`);
  },
});

const unscheduleCmd = defineCommand({
  meta: { name: "unschedule", description: "Remove a problem from the roadmap (back to null)." },
  args: { id: { type: "positional", required: true }, json: { type: "boolean" } },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const payload: UnscheduleProblemPayload = { id: args.id };
    const { result } = await api().dispatch({ kind: "UNSCHEDULE_PROBLEM", payload });
    emit(result, OkWithStatusOutput, `unscheduled ${args.id}`);
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
    const { result } = await api().dispatch({ kind: "ABANDON_PROBLEM", payload });
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
    abandon: abandonCmd,
  },
});
