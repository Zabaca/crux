"use client";

import { useEffect } from "react";

export function SyncViewState({
  workstreamSlug,
  problemSlug,
  queue,
}: {
  workstreamSlug: string | null;
  problemSlug?: string | null;
  queue?: "intake" | null;
}) {
  useEffect(() => {
    fetch("/api/view-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workstreamSlug,
        problemSlug: problemSlug ?? null,
        queue: queue ?? null,
      }),
    }).catch(() => {});
  }, [workstreamSlug, problemSlug, queue]);

  return null;
}
