"use client";

import { useEffect, useState } from "react";

type RecentQuery = {
  kind: string;
  slug?: string;
  ts: number;
};

type ViewStateSse = {
  type: "init" | "change";
  recentQueries?: RecentQuery[];
};

/**
 * Floating panel that shows the last 10 read queries recorded by the CLI.
 * Updates in real time via the SSE stream on /api/view-state.
 *
 * Hidden when no queries exist.
 */
export function RecentQueriesPanel() {
  const [queries, setQueries] = useState<RecentQuery[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/view-state");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ViewStateSse;
        if (msg.recentQueries) {
          setQueries(msg.recentQueries);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  if (queries.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
      >
        Recent ({queries.length})
      </button>
      {open && (
        <div className="mt-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Recent Queries
          </p>
          <ul className="space-y-1">
            {queries.map((q, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-zinc-300">{q.kind}</span>
                {q.slug && <span className="truncate text-zinc-500">{q.slug}</span>}
                <span className="shrink-0 text-zinc-600">
                  {new Date(q.ts).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
