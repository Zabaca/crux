"use client";

import { useEffect } from "react";

let inflight: Promise<void> | null = null;

function postSync(
  workstreamSlug: string | null,
  problemSlug: string | null | undefined,
  queue: "intake" | "ideas" | null | undefined,
): Promise<void> {
  return fetch("/api/view-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workstreamSlug,
      problemSlug: problemSlug ?? null,
      queue: queue ?? null,
    }),
  }).then(async (res) => {
    let body: { ok?: boolean; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    if (!res.ok || body.ok === false) {
      throw new Error(body.error ?? `view-state sync failed (${res.status})`);
    }
  });
}

export function useViewSync(): { ensureSynced: () => Promise<void> } {
  return {
    ensureSynced: () => inflight ?? Promise.resolve(),
  };
}

export function SyncViewState({
  workstreamSlug,
  problemSlug,
  queue,
}: {
  workstreamSlug: string | null;
  problemSlug?: string | null;
  queue?: "intake" | "ideas" | null;
}) {
  useEffect(() => {
    const promise = postSync(workstreamSlug, problemSlug, queue);
    inflight = promise;
    promise.catch((err) => {
      console.error("[view-state] sync failed:", err);
    });
  }, [workstreamSlug, problemSlug, queue]);

  return null;
}
