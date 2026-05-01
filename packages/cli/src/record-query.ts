/**
 * recordQuery — append a CLI read-command query to recentQueries in view-state.json.
 * No-op if the view-state path doesn't exist yet (first run).
 */
import { loadViewMeta, saveViewMeta } from "@crux/core/view-state";
import { appendRecentQuery } from "@crux/core/actions";

export function recordQuery(kind: string, slug?: string): void {
  try {
    const meta = loadViewMeta();
    meta.recentQueries = appendRecentQuery(meta.recentQueries, {
      kind,
      slug,
      ts: Date.now(),
    });
    saveViewMeta(meta);
  } catch {
    // Best-effort — never fail a read command because of recentQueries
  }
}
