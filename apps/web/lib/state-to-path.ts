/**
 * Pure mapper from a view machine snapshot (as JSON) to a URL path.
 *
 * Used by the SSE listener (to navigate on incoming state) and by link
 * click handlers on the client (to compute the local href). Keeping the
 * function pure + shared is what keeps the two paths in sync.
 */

export type ViewSnapshotJson = {
  value: unknown;
  context: { workstreamId: string | null; problemId: string | null };
};

export function stateToPath(snapshot: ViewSnapshotJson): string {
  const leaf = formatValue(snapshot.value);
  const ctx = snapshot.context ?? { workstreamId: null, problemId: null };

  const wsSlug = ctx.workstreamId ? extractSlug(ctx.workstreamId) : null;
  const probSlug = ctx.problemId ? extractSlug(ctx.problemId) : null;

  console.log("[stateToPath]", { leaf, wsSlug, probSlug, context: ctx });

  if (leaf.endsWith("problem_detail") && wsSlug && probSlug) {
    return `/w/${wsSlug}/problems/${probSlug}`;
  }
  if (leaf.endsWith("intake_queue") && wsSlug) {
    return `/w/${wsSlug}/queues/intake`;
  }
  if (leaf.endsWith("workstream_dashboard") && wsSlug) {
    return `/w/${wsSlug}`;
  }
  return "/";
}

function extractSlug(id: string): string {
  const match = id.match(/^[A-Z]+-(.+)$/);
  return match ? match[1] : id;
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
