"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stateToPath, type ViewSnapshotJson } from "@/lib/state-to-path";

/** The 5 view-action kind strings — must stay in sync with ViewActionKind. */
const VIEW_ACTION_KINDS = new Set([
  "SELECT_WORKSTREAM",
  "OPEN_PROBLEM",
  "SELECT_INTAKE",
  "SELECT_IDEAS",
  "BACK",
]);

type LastAction = { kind: string; ts: number } | null;
type ViewStateMessage = ViewSnapshotJson & {
  type: "init" | "change";
  revision?: number;
  lastAction?: LastAction;
};

/**
 * Client-side bridge: opens an EventSource to /api/view-state and routes
 * the browser to the path derived from agent-driven state changes.
 *
 * On "change" events:
 *   - ViewAction (lastAction.kind in VIEW_ACTION_KINDS) → router.push(stateToPath(msg))
 *   - MutationAction → router.refresh() (data invalidation without navigation)
 *   - No lastAction → fall back to navigation (legacy behavior)
 *
 * "init" events are ignored so manual browser navigation isn't overridden.
 */
export function ViewStateListener() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const es = new EventSource("/api/view-state");
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ViewStateMessage;
        if (msg.type !== "change") return;

        const lastKind = msg.lastAction?.kind;

        if (!lastKind || VIEW_ACTION_KINDS.has(lastKind)) {
          // Navigation-only action or legacy: push to derived path
          const target = stateToPath(msg);
          if (target !== pathname) {
            router.push(target);
          } else {
            router.replace(target);
          }
        } else {
          // MutationAction: refresh current page data without navigating
          router.refresh();
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // Let the browser auto-reconnect; no console spam.
    };
    return () => {
      es.close();
    };
  }, [router, pathname]);

  return null;
}
