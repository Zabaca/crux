"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stateToPath, type ViewSnapshotJson } from "@/lib/state-to-path";

/**
 * Client-side bridge: opens an EventSource to /api/view-state and routes
 * the browser to the path derived from each incoming machine snapshot.
 *
 * Mounted in root layout so every page participates in the bus.
 */
export function ViewStateListener() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const es = new EventSource("/api/view-state");
    es.onmessage = (ev) => {
      try {
        const snap = JSON.parse(ev.data) as ViewSnapshotJson;
        const target = stateToPath(snap);
        // Use replace when we're already at the target to avoid polluting history.
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
