import { defineCommand } from "citty";
import type { SearchResults } from "@crux/core/reads";
import { CruxError } from "@crux/core/transitions";
import { emit, setJsonMode } from "../output.js";
import { api } from "../api-client.js";

/**
 * The read you run *before* filing a Problem. Duplication among Observations is
 * by design and cheap; duplication among Problems is what hurts, and the only
 * fix that scales is looking first. Unlike the rest of the CLI this does not
 * default to the workstream in view state — a near-twin filed in the wrong
 * Workstream is exactly the thing worth finding, so no scope is the default and
 * `--workstream` narrows it.
 *
 * Archived Observations are out of it unless `--show-archived` asks for them,
 * which trades a weaker duplicate hunt for never handing back a row somebody
 * has already retired (ADR-0017).
 */
export const searchCommand = defineCommand({
  meta: {
    name: "search",
    description: "Search Problems and Observations for a near-duplicate, before filing one.",
  },
  args: {
    query: { type: "positional", required: true, description: "Substring to look for." },
    workstream: {
      type: "string",
      alias: "w",
      description: "Limit to one workstream (slug or id). Omit to search all of them.",
    },
    limit: { type: "string", description: "Max matches of each kind. Default 20." },
    "show-archived": {
      type: "boolean",
      description:
        "Include archived Observations. Without it — the default — a row that " +
        "has been archived does not match at all.",
    },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    // Only the parse is local — the range `SEARCH` accepts is the server's, so
    // there is one definition of it (ADR-0003) and the same code comes back
    // whether the number is unparseable or merely out of range.
    const limit = args.limit === undefined ? undefined : Number(args.limit);
    if (limit !== undefined && !Number.isInteger(limit)) {
      throw new CruxError(
        "VALIDATION_ERROR",
        `--limit must be a whole number, got: ${args.limit}`,
        {
          limit: args.limit,
        },
      );
    }
    const results = await api().query<SearchResults>({
      kind: "SEARCH",
      q: args.query,
      workstream: args.workstream,
      limit,
      showArchived: Boolean(args["show-archived"]),
    });
    const lines = [
      ...results.problems.flatMap((p) => [
        `PROBLEM\t${p.id}\t${p.workstreamSlug}\t${p.status ?? "unscheduled"}\t${p.title}`,
        // The description, not just the title: sameness is judged on it, and a
        // list of titles is not enough to decide you already filed this.
        `\t${p.description}`,
      ]),
      ...results.observations.map(
        (o) =>
          `OBSERVATION\t${o.id}\t${o.workstreamSlug}\t${o.content}` +
          (o.archive ? `\t[archived — ${o.archive.rationale ?? "no rationale recorded"}]` : ""),
      ),
    ];
    emit(results, lines.join("\n") || "(no matches)");
  },
});
