"use client";

import { useState } from "react";

export function NotifyButton() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const notify = async () => {
    setState("sending");
    try {
      const res = await fetch("/api/notify", { method: "POST" });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
    setTimeout(() => setState("idle"), 2000);
  };

  const label =
    state === "sending"
      ? "..."
      : state === "sent"
        ? "✓ sent"
        : state === "error"
          ? "failed"
          : "@ Claude";

  return (
    <button
      onClick={notify}
      disabled={state === "sending"}
      className="fixed bottom-4 right-4 z-50 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 disabled:opacity-50 transition-all"
    >
      {label}
    </button>
  );
}
