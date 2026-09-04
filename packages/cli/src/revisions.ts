import type { RevisionEntry } from "@crux/core/reads";

/**
 * A row's history as one line per correction (ADR-0017).
 *
 * The *values* a revision replaced are in the JSON; the human line names the
 * fields, when, and why — enough to decide which entry to look at, which is all
 * a history read is for. Every entity's `revisions` command prints the same
 * shape, because they are all reading the same table.
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
