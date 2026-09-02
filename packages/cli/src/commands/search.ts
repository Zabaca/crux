import { defineCommand } from "citty";
import type { SearchResults } from "@crux/core/reads";
import { emit, setJsonMode } from "../output.js";
import { api } from "../api-client.js";

/**
 * The read you run *before* filing a Problem. Duplication among Observations is
 * by design and cheap; duplication among Problems is what hurts, and the only
 * fix that scales is looking first. Unlike the rest of the CLI this does not
 * default to the workstream in view state — a near-twin filed in the wrong
 * Workstream is exactly the thing worth finding, so no scope is the default and
 * `--workstream` narrows it.
 */
export const searchCommand = defineCommand({
  meta: {
    name: "search",
    description: "Search Problems and Observations for a near-duplicate, before filing one.",
  },
  args: {
    terms: { type: "positional", required: true, description: "Substring to look for." },
    workstream: {
      type: "string",
      alias: "w",
      description: "Limit to one workstream (slug or id). Omit to search all of them.",
    },
    limit: { type: "string", description: "Max matches of each kind. Default 20." },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const limit = args.limit ? Number(args.limit) : undefined;
    if (limit !== undefined && !Number.isInteger(limit)) {
      throw new Error(`--limit must be a whole number, got: ${args.limit}`);
    }
    const results = await api().query<SearchResults>({
      kind: "SEARCH",
      q: args.terms,
      workstream: args.workstream,
      limit,
    });
    const lines = [
      ...results.problems.map(
        (p) => `PROBLEM\t${p.id}\t${p.workstreamSlug}\t${p.status ?? "unscheduled"}\t${p.title}`,
      ),
      ...results.observations.map(
        (o) => `OBSERVATION\t${o.id}\t${o.workstreamSlug}\t${o.content.slice(0, 80)}`,
      ),
    ];
    emit(results, lines.join("\n") || "(no matches)");
  },
});
