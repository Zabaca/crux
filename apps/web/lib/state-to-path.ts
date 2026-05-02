/**
 * Pure mapper from a view machine snapshot (as JSON) to a URL path.
 */

export type ViewSnapshotJson = {
  value: unknown;
  context: { workstreamId: string | null; problemId: string | null };
};

export function stateToPath(snapshot: ViewSnapshotJson): string {
  const leaf = formatValue(snapshot.value);
  const ctx = snapshot.context ?? { workstreamId: null, problemId: null };

  const wsId = ctx.workstreamId; // e.g. "WS-crux"
  const probId = ctx.problemId; // e.g. "42"

  console.log("[stateToPath]", { leaf, wsId, probId, context: ctx });

  if (leaf.endsWith("problem_detail") && wsId && probId) {
    return `/w/${wsId}/problems/${probId}`;
  }
  if (leaf.endsWith("intake_queue") && wsId) {
    return `/w/${wsId}/queues/intake`;
  }
  if (leaf.endsWith("workstream_dashboard") && wsId) {
    return `/w/${wsId}`;
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
