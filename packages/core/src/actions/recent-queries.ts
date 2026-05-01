/**
 * recentQueries helpers — append, dedupe, and cap the recentQueries list
 * in view-state.json.
 */

export type RecentQuery = {
  kind: string;
  slug?: string;
  ts: number;
};

const MAX_RECENT = 10;

/**
 * Append a new query entry, deduplicate (same kind+slug keeps the newer ts),
 * and cap at MAX_RECENT. Newest entries are at the front.
 */
export function appendRecentQuery(existing: RecentQuery[], entry: RecentQuery): RecentQuery[] {
  // Dedupe: remove any prior entry with same kind+slug
  const filtered = existing.filter(
    (q) => !(q.kind === entry.kind && (q.slug ?? null) === (entry.slug ?? null)),
  );
  // Prepend newest
  const next = [entry, ...filtered];
  // Cap
  return next.slice(0, MAX_RECENT);
}
