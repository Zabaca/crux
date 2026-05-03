"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ViewLeaf = "workstream_list" | "workstream_dashboard" | "problem_detail" | "intake_queue";

type Context = {
  workstreamId?: string | null;
  problemId?: string | null;
};

type RecentQuery = {
  kind: string;
  slug?: string;
  ts: number;
};

type ViewStateMessage = {
  type: "init" | "change";
  value: unknown;
  context: { workstreamId: string | null; problemId: string | null };
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
  const [context, setContext] = useState<Context>({ workstreamId: null, problemId: null });
  const [queries, setQueries] = useState<RecentQuery[]>([]);

  useEffect(() => {
    // Fetch current state as JSON first
    const loadInitialState = async () => {
      try {
        const res = await fetch("/api/view-state-json");
        const data = (await res.json()) as ViewStateMessage;
        const viewing = extractViewingLeaf(data.value);
        console.log("[RD] Initial state loaded:", {
          viewing,
          context: data.context,
          recentQueriesCount: data.recentQueries?.length ?? 0,
        });
        setViewing(viewing);
        if (data.context) setContext(data.context);
        if (data.recentQueries) {
          setQueries(data.recentQueries);
        }
      } catch (err) {
        console.error("[RD] Failed to load initial state:", err);
      }
    };

    loadInitialState();

    // Then connect to SSE for live updates
    console.log("[RD] Connecting to SSE for live updates");
    const es = new EventSource("/api/view-state");
    es.onopen = () => {
      console.log("[RD] ✅ SSE connection opened");
    };
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ViewStateMessage;
        const viewing = extractViewingLeaf(msg.value);
        console.log("[RD] SSE update:", {
          type: msg.type,
          viewing,
          wsId: msg.context.workstreamId,
          probId: msg.context.problemId,
          recentQueriesCount: msg.recentQueries?.length ?? 0,
        });
        setViewing(viewing);
        setContext(msg.context);
        if (msg.recentQueries) {
          setQueries(msg.recentQueries);
        }
      } catch (err) {
        console.error("[RD] SSE parse error:", err);
      }
    };
    es.onerror = (err) => {
      console.error("[RD] ❌ SSE connection error:", err);
    };
    return () => {
      console.log("[RD] Closing SSE connection");
      es.close();
    };
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
          {/* State display section */}
          <div className="flex-none p-4 border-b space-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Viewing:</span>
              <div className="font-mono text-foreground mt-1">{viewing}</div>
            </div>
            {context.workstreamId && (
              <div>
                <span className="text-muted-foreground">Workstream:</span>
                <div className="font-mono text-foreground mt-1">{context.workstreamId}</div>
              </div>
            )}
            {context.problemId && (
              <div>
                <span className="text-muted-foreground">Problem:</span>
                <div className="font-mono text-foreground mt-1">{context.problemId}</div>
              </div>
            )}
          </div>

          {/* Queue buttons section */}
          {context.workstreamId && (
            <div className="flex-none p-4 border-b space-y-2">
              <Link
                href={`/w/${context.workstreamId}/queues/intake`}
                className="block text-xs rounded border px-2 py-1 hover:bg-accent text-center transition-colors"
              >
                Intake queue
              </Link>
            </div>
          )}

          {/* Recent queries section */}
          <div className="flex-1 p-4 overflow-y-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Recent Queries
            </p>
            {queries.length > 0 ? (
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
            ) : (
              <p className="text-xs text-muted-foreground italic">No recent queries</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
