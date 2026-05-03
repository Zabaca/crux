"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchAction } from "@/lib/dispatch-action";
import { ActionDialog } from "./action-dialog";

export function SolutionActions({
  solution,
}: {
  solution: { id: number; status: string; title: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"edit" | "outcome" | null>(null);
  const [shipping, setShipping] = useState(false);

  const close = () => {
    setOpen(null);
    router.refresh();
  };

  const ship = async () => {
    setShipping(true);
    await dispatchAction("SHIP_SOLUTION", { id: solution.id });
    setShipping(false);
    router.refresh();
  };

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setOpen("edit")}
        className="rounded border px-3 py-1 text-sm hover:bg-accent"
      >
        Edit
      </button>

      {solution.status === "chosen" && (
        <button
          type="button"
          onClick={ship}
          disabled={shipping}
          className="rounded border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
        >
          {shipping ? "..." : "Ship"}
        </button>
      )}

      {solution.status === "shipped" && (
        <button
          type="button"
          onClick={() => setOpen("outcome")}
          className="rounded border px-3 py-1 text-sm hover:bg-accent"
        >
          Record outcome
        </button>
      )}

      <ActionDialog
        kind="EDIT_SOLUTION"
        title="Edit solution"
        fields={[
          { name: "solutionId", hidden: true, defaultValue: String(solution.id) },
          { name: "title", label: "title (optional)", defaultValue: solution.title },
          { name: "description", label: "description (optional)", type: "textarea" },
        ]}
        open={open === "edit"}
        onClose={close}
      />

      <ActionDialog
        kind="ADD_OUTCOME"
        title="Record outcome"
        fields={[
          { name: "solution", hidden: true, defaultValue: String(solution.id) },
          { name: "observedImpact", label: "observed impact", type: "textarea", required: true },
          { name: "expectedImpact", label: "expected impact (optional)", type: "textarea" },
          { name: "learnings", label: "learnings (optional)", type: "textarea" },
        ]}
        open={open === "outcome"}
        onClose={close}
      />
    </div>
  );
}
