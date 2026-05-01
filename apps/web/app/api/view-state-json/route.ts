import { loadState, loadViewMeta, resolveViewStatePath } from "@crux/core/view-state";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const path = resolveViewStatePath();
    const snap = loadState(path);
    const meta = loadViewMeta(path);
    return Response.json({
      value: snap.value,
      context: snap.context,
      revision: meta.revision,
      lastAction: meta.lastAction,
      recentQueries: meta.recentQueries,
    });
  } catch {
    return Response.json({
      value: { viewing: "workstream_list" },
      context: { workstreamId: null, problemId: null },
      revision: 0,
      lastAction: null,
      recentQueries: [],
    });
  }
}
