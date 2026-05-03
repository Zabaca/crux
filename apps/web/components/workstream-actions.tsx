"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionDialog } from "./action-dialog";

export function WorkstreamActions({ wsId }: { wsId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"problem" | "observation" | null>(null);

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setOpen("problem")}
        className="rounded border px-3 py-1 text-sm hover:bg-accent"
      >
        Add problem
      </button>
      <button
        type="button"
        onClick={() => setOpen("observation")}
        className="rounded border px-3 py-1 text-sm hover:bg-accent"
      >
        Add observation
      </button>

      <ActionDialog
        kind="ADD_PROBLEM"
        title="Add problem"
        fields={[
          { name: "workstream", hidden: true, defaultValue: wsId },
          { name: "title", required: true },
          { name: "description", type: "textarea", required: true },
        ]}
        open={open === "problem"}
        onClose={() => {
          setOpen(null);
          router.refresh();
        }}
      />

      <ActionDialog
        kind="ADD_OBSERVATION"
        title="Add observation"
        fields={[
          { name: "workstream", hidden: true, defaultValue: wsId },
          { name: "content", type: "textarea", required: true },
          { name: "source", label: "source (optional)" },
          {
            name: "sourceType",
            label: "source type",
            type: "select",
            options: [
              { value: "internal", label: "internal" },
              { value: "competitive", label: "competitive" },
              { value: "external", label: "external" },
              { value: "analysis", label: "analysis" },
              { value: "customer_report", label: "customer report" },
              { value: "metric_signal", label: "metric signal" },
            ],
          },
        ]}
        open={open === "observation"}
        onClose={() => {
          setOpen(null);
          router.refresh();
        }}
      />
    </div>
  );
}
