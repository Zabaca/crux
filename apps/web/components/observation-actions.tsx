"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionDialog } from "./action-dialog";

export function ObservationActions({
  wsId,
  obsId,
  archived,
}: {
  wsId: string;
  obsId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"archive" | "evidence" | null>(null);

  const close = () => {
    setOpen(null);
    router.refresh();
  };

  return (
    <div className="flex gap-2">
      {!archived && (
        <button
          type="button"
          onClick={() => setOpen("archive")}
          className="rounded border px-3 py-1 text-sm hover:bg-accent"
        >
          Archive
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen("evidence")}
        className="rounded border px-3 py-1 text-sm hover:bg-accent"
      >
        Link as evidence
      </button>

      <ActionDialog
        kind="ARCHIVE_OBSERVATION"
        title="Archive observation"
        fields={[
          { name: "id", hidden: true, defaultValue: obsId },
          { name: "rationale", label: "rationale (optional)", type: "textarea" },
        ]}
        open={open === "archive"}
        onClose={close}
      />

      <ActionDialog
        kind="ADD_EVIDENCE"
        title="Link as evidence"
        fields={[
          { name: "observation", hidden: true, defaultValue: obsId },
          { name: "problem", label: "problem id (e.g. PRO-001)", required: true },
          { name: "note", label: "why-note (optional)", type: "textarea" },
        ]}
        open={open === "evidence"}
        onClose={close}
      />
    </div>
  );
}
