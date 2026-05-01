"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MutationToolbar } from "./mutation-toolbar";

type ViewLeaf =
  | "workstream_list"
  | "workstream_dashboard"
  | "problem_detail"
  | "intake_queue"
  | "ideas_queue";

type Context = {
  workstreamSlug?: string | null;
  problemSlug?: string | null;
};

type RecentQuery = {
  kind: string;
  slug?: string;
  ts: number;
};

type ViewStateMessage = {
  type: "init" | "change";
  value: unknown;
  context: { workstreamSlug: string | null; problemSlug: string | null };
  recentQueries?: RecentQuery[];
};

function extractViewingLeaf(value: unknown): ViewLeaf {
  if (typeof value === "object" && value !== null && "viewing" in value) {
    const viewing = (value as Record<string, unknown>).viewing;
    if (typeof viewing === "string") {
      return viewing as ViewLeaf;
    }
  }
  return "workstream_list";
}

export function RightDrawer() {
  const [open, setOpen] = useState(true);
  const [viewing, setViewing] = useState<ViewLeaf>("workstream_list");
  const [context, setContext] = useState<Context>({ workstreamSlug: null, problemSlug: null });
  const [queries, setQueries] = useState<RecentQuery[]>([]);

  useEffect(() => {
    const es = new EventSource("/api/view-state");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ViewStateMessage;
        setViewing(extractViewingLeaf(msg.value));
        setContext(msg.context);
        if (msg.recentQueries) {
          setQueries(msg.recentQueries);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, []);

  return (
    <div className="fixed right-0 top-0 h-screen z-40 flex">
      {/* Toggle tab */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="absolute left-[-32px] top-1/2 -translate-y-1/2 w-8 h-16 rounded-l border border-r-0 bg-background hover:bg-accent flex items-center justify-center text-sm transition-colors"
        title={open ? "Collapse" : "Expand"}
      >
        {open ? "‹" : "›"}
      </button>

      {/* Panel body */}
      {open && (
        <div className="w-64 border-l bg-background flex flex-col h-full overflow-y-auto">
          {/* Queue buttons section */}
          {context.workstreamSlug && (
            <div className="flex-none p-4 border-b space-y-2">
              <Link
                href={`/w/${context.workstreamSlug}/queues/intake`}
                className="block text-xs rounded border px-2 py-1 hover:bg-accent text-center transition-colors"
              >
                Intake queue
              </Link>
              <Link
                href={`/w/${context.workstreamSlug}/queues/ideas`}
                className="block text-xs rounded border px-2 py-1 hover:bg-accent text-center transition-colors"
              >
                Ideas queue
              </Link>
            </div>
          )}

          {/* Actions section */}
          <div className="flex-none p-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Actions
            </p>
            <MutationToolbar view={viewing} context={context} />
          </div>

          {/* Recent queries section */}
          {queries.length > 0 && (
            <div className="flex-1 p-4 overflow-y-auto">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Recent Queries
              </p>
              <ul className="space-y-1">
                {queries.map((q, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-foreground">{q.kind}</span>
                    {q.slug && <span className="truncate text-muted-foreground">{q.slug}</span>}
                    <span className="shrink-0 text-muted-foreground text-[11px]">
                      {new Date(q.ts).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
