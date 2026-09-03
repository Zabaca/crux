import { defineCommand } from "citty";
import { ContextOutput } from "@crux/core/validation";
import { emit, setJsonMode } from "../output.js";
import { api } from "../api-client.js";
import { requireWorkstream, workstreamArg } from "../require-args.js";

const VALID_STAGES = ["now", "next", "later", "unscheduled", "done", "abandoned"];

export const contextCommand = defineCommand({
  meta: {
    name: "context",
    description: "Emit a JSON digest of the workstream for session reload.",
  },
  args: {
    ...workstreamArg(),
    "show-archived": {
      type: "boolean",
      description: "Include archived Observations in the unlinked-observations section.",
    },
    stage: {
      type: "string",
      alias: "t",
      description:
        "Comma-separated stage buckets to include: now,next,later,unscheduled,done,abandoned. Defaults to 'now'.",
    },
    all: {
      type: "boolean",
      description: "Emit all stage buckets plus recent_observations_unlinked.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const wsVal = requireWorkstream(args.workstream);

    const stages = args.all
      ? [...VALID_STAGES]
      : args.stage
        ? (args.stage as string)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : ["now"];

    const digest = await api().query({
      kind: "CONTEXT",
      workstream: wsVal,
      stages,
      includeExtras: Boolean(args.all),
      showArchived: Boolean(args["show-archived"]),
    });
    emit(digest, ContextOutput);
  },
});
