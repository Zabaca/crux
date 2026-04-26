"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stateToPath, type ViewSnapshotJson } from "@/lib/state-to-path";

type ViewStateMessage = ViewSnapshotJson & { type: "init" | "change" };

/**
 * Client-side bridge: opens an EventSource to /api/view-state and routes
 * the browser to the path derived from agent-driven state changes.
 *
 * Only navigates on "change" events — "init" events (emitted on connect/reconnect)
 * are ignored so manual browser navigation isn't overridden.
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
        const target = stateToPath(msg);
        if (target !== pathname) {
          router.push(target);
        } else {
          router.replace(target);
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
