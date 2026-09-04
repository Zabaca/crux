import type { RevisionEntry } from "@crux/core/reads";

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
