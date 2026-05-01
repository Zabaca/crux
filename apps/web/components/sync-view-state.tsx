"use client";

import { useEffect } from "react";

export function SyncViewState({
  workstreamId,
  problemId,
  queue,
}: {
  workstreamId: string | null;
  problemId?: string | null;
  queue?: "intake" | null;
}) {
  useEffect(() => {
    fetch("/api/view-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workstreamId,
        problemId: problemId ?? null,
        queue: queue ?? null,
      }),
    }).catch(() => {});
  }, [workstreamId, problemId, queue]);

  return null;
}
