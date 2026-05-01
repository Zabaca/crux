"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { stateToPath, type ViewSnapshotJson } from "@/lib/state-to-path";

/**
 * Kinds the listener treats as navigation (ViewAction-like).
 * Must stay in sync with ViewActionKind in @crux/core/actions.
 * RESET is included so `crux view reset` re-routes the tab to the initial path.
 */
const VIEW_ACTION_KINDS = new Set([
  "SELECT_WORKSTREAM",
  "OPEN_PROBLEM",
  "SELECT_INTAKE",
  "BACK",
  "RESET",
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
    console.log("[ViewStateListener] Connecting to SSE from pathname:", pathname);
    const es = new EventSource("/api/view-state");
    let msgCount = 0;

    es.onopen = () => {
      console.log("[ViewStateListener] SSE connection established");
    };

    es.onmessage = (ev) => {
      msgCount++;
      const logPrefix = `[VSL#${msgCount}]`;
      console.log(`${logPrefix} Message received, data length: ${ev.data.length}`);
      try {
        const msg = JSON.parse(ev.data) as ViewStateMessage;
        const viewing = (msg.value as any)?.viewing;
        console.log(`${logPrefix} Parsed:`, {
          type: msg.type,
          viewing,
          wsId: msg.context.workstreamId,
          probId: msg.context.problemId,
          lastKind: msg.lastAction?.kind,
        });
        console.log(`${logPrefix} Full lastAction:`, msg.lastAction);

        if (msg.type !== "change") {
          console.log(`${logPrefix} ⚠️  Type is "${msg.type}", ignoring (only process "change")`);
          return;
        }

        const lastKind = msg.lastAction?.kind;
        const isNavAction = !lastKind || VIEW_ACTION_KINDS.has(lastKind);
        console.log(`${logPrefix} Decision: lastKind="${lastKind}" → isNavAction=${isNavAction}`);

        if (!lastKind) {
          console.log(`${logPrefix}   (no lastAction, treating as nav by default)`);
        } else if (VIEW_ACTION_KINDS.has(lastKind)) {
          console.log(
            `${logPrefix}   (lastKind in VIEW_ACTION_KINDS: ${Array.from(VIEW_ACTION_KINDS).join(", ")})`,
          );
        } else {
          console.log(`${logPrefix}   (lastKind NOT in VIEW_ACTION_KINDS, is MutationAction)`);
        }

        if (isNavAction) {
          const target = stateToPath(msg);
          console.log(`${logPrefix} 📍 stateToPath returned: "${target}"`);
          console.log(`${logPrefix} 📍 current pathname: "${pathname}"`);
          if (target !== pathname) {
            console.log(`${logPrefix} ✅ Paths differ → router.push("${target}")`);
            router.push(target);
          } else {
            console.log(`${logPrefix} ⏸️  Paths same → router.replace("${target}")`);
            router.replace(target);
          }
        } else {
          console.log(`${logPrefix} 🔄 MutationAction → router.refresh()`);
          router.refresh();
        }
      } catch (err) {
        console.error(`${logPrefix} ❌ Error:`, err);
      }
    };

    es.onerror = (err) => {
      console.error("[ViewStateListener] SSE connection error:", err);
    };

    return () => {
      console.log("[ViewStateListener] Closing SSE connection");
      es.close();
    };
  }, [router, pathname]);

  return null;
}
