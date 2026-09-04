import { defineCommand } from "citty";

import type { RevisionEntry } from "@crux/core/reads";
import { api } from "./api-client.js";
import { emit, setJsonMode } from "./output.js";

/**
 * The two halves of correcting a row that are the same for every entity
 * (ADR-0017): what a `revise` prints, and the whole of a `revisions` command.
 *
 * The `revise` commands themselves stay hand-written — each names its own
 * fields, which is the point of not having one polymorphic verb — but what they
 * do with the answer is identical, and five copies of it is five places for the
 * wording to drift.
 */

/** What a `revise` says it did: the row, and which of its fields moved. */
export function emitRevised(result: unknown, id: string): void {
  const { changedFields } = result as { changedFields: string[] };
  emit(result, `revised ${id} — ${changedFields.join(", ")}`);
}

/**
 * A row's history, one line per correction, newest first (ADR-0017).
 *
 * The line names *which* fields changed and not what they said, because a
 * previous description is a paragraph: the `--json` shape carries the values,
 * and the terminal carries the index into them.
 */
export function formatRevisions(rows: RevisionEntry[]): string {
  return (
    rows
      .map(
        (r) =>
          `${r.id}\t${new Date(r.revisedAt).toISOString()}\t${Object.keys(r.changed).join(", ")}${r.reason ? `\t${r.reason}` : ""}`,
      )
      .join("\n") || "(none)"
  );
}

/**
 * The `revisions` subcommand for one entity. They differ only in the named read
 * they issue and in what the id is called, so the command itself is built rather
 * than written out five times.
 */
export function revisionsCommand(opts: { kind: string; noun: string; idHint: string }) {
  return defineCommand({
    meta: { name: "revisions", description: `What ${opts.noun} used to say.` },
    args: {
      id: { type: "positional", required: true, description: opts.idHint },
      json: { type: "boolean" },
    },
    async run({ args }) {
      if (args.json) setJsonMode(true);
      const rows = await api().query<RevisionEntry[]>({ kind: opts.kind, id: args.id });
      emit(rows, formatRevisions(rows));
    },
  });
}
