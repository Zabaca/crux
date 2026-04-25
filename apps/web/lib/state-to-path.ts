/**
 * Pure mapper from a view machine snapshot (as JSON) to a URL path.
 *
 * Used by the SSE listener (to navigate on incoming state) and by link
 * click handlers on the client (to compute the local href). Keeping the
 * function pure + shared is what keeps the two paths in sync.
 */

export type ViewSnapshotJson = {
  value: unknown;
  context: { workstreamSlug: string | null; problemSlug: string | null };
};

export function stateToPath(snapshot: ViewSnapshotJson): string {
  const leaf = formatValue(snapshot.value);
  const ctx = snapshot.context ?? { workstreamSlug: null, problemSlug: null };
  if (leaf.endsWith("problem_detail") && ctx.workstreamSlug && ctx.problemSlug) {
    return `/w/${ctx.workstreamSlug}/problems/${ctx.problemSlug}`;
  }
  if (leaf.endsWith("workstream_dashboard") && ctx.workstreamSlug) {
    return `/w/${ctx.workstreamSlug}`;
  }
  return "/";
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  const parts: string[] = [];
  let cur: unknown = value;
  while (cur && typeof cur === "object") {
    const obj = cur as Record<string, unknown>;
    const key = Object.keys(obj)[0];
    if (!key) break;
    parts.push(key);
    cur = obj[key];
  }
  if (typeof cur === "string") parts.push(cur);
  return parts.join(".");
}
