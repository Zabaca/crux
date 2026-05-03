"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dispatchAction, type ActionResponse } from "@/lib/dispatch-action";
import { ActionDialog } from "./action-dialog";

type SolutionStub = { id: number; title: string; status: string };

type Props = {
  wsId: string;
  problemId: number;
  status: string | null;
  solutions: SolutionStub[];
};

// ---------------------------------------------------------------------------
// Record Decision modal — radio for chosen, checkboxes for rejected
// ---------------------------------------------------------------------------

function RecordDecisionModal({
  problemId,
  proposed,
  onClose,
}: {
  problemId: number;
  proposed: SolutionStub[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionResponse | null>(null);
  const router = useRouter();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const chosen = fd.get("chosen") as string;
    const rejected = fd
      .getAll("rejected")
      .map(Number)
      .filter((n) => n !== Number(chosen));
    const rationale = fd.get("rationale") as string;
    const context = (fd.get("context") as string) || undefined;

    const res = await dispatchAction("ADD_DECISION", {
      problem: problemId,
      chosen: Number(chosen),
      rejected,
      rationale,
      context,
    });
    setSubmitting(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="rounded-lg border bg-background p-0 shadow-xl backdrop:bg-black/40 max-w-md w-full"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Record decision</h2>
          <span className="font-mono text-xs text-muted-foreground">ADD_DECISION</span>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">
            Chosen solution <span className="text-red-600">*</span>
          </p>
          {proposed.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name="chosen" value={s.id} required />
              <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
              <span>{s.title}</span>
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">Rejected solutions</p>
          {proposed.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="rejected" value={s.id} />
              <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
              <span>{s.title}</span>
            </label>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium">
            Rationale <span className="text-red-600">*</span>
          </span>
          <textarea
            name="rationale"
            required
            rows={3}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Context (optional)</span>
          <textarea
            name="context"
            rows={2}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />
        </label>

        {error && !error.ok ? (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900 space-y-1">
            <div className="font-mono">{error.code}</div>
            <div>{error.message}</div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-1 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "..." : "Submit"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Eliminate modal — checkboxes for solutions
// ---------------------------------------------------------------------------

function EliminateModal({ proposed, onClose }: { proposed: SolutionStub[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionResponse | null>(null);
  const router = useRouter();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const solutions = fd.getAll("solutions").map(Number);
    const rationale = fd.get("rationale") as string;
    const context = (fd.get("context") as string) || undefined;

    if (solutions.length === 0) {
      setError({ ok: false, code: "INVALID_PAYLOAD", message: "Select at least one solution." });
      setSubmitting(false);
      return;
    }

    const res = await dispatchAction("ADD_ELIMINATION", { solutions, rationale, context });
    setSubmitting(false);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res);
    }
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="rounded-lg border bg-background p-0 shadow-xl backdrop:bg-black/40 max-w-md w-full"
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Eliminate solutions</h2>
          <span className="font-mono text-xs text-muted-foreground">ADD_ELIMINATION</span>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium">
            Solutions to eliminate <span className="text-red-600">*</span>
          </p>
          {proposed.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="solutions" value={s.id} />
              <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
              <span>{s.title}</span>
            </label>
          ))}
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium">
            Rationale <span className="text-red-600">*</span>
          </span>
          <textarea
            name="rationale"
            required
            rows={3}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium">Context (optional)</span>
          <textarea
            name="context"
            rows={2}
            className="w-full rounded border bg-background px-2 py-1 text-sm"
          />
        </label>

        {error && !error.ok ? (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900 space-y-1">
            <div className="font-mono">{error.code}</div>
            <div>{error.message}</div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-1 text-sm hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "..." : "Submit"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// ProblemActions — main export
// ---------------------------------------------------------------------------

type DialogKind =
  | "schedule"
  | "abandon"
  | "evidence"
  | "solution"
  | "decision"
  | "eliminate"
  | null;

export function ProblemActions({ wsId: _wsId, problemId, status, solutions }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogKind>(null);
  const [acting, setActing] = useState(false);

  const proposed = solutions.filter((s) => s.status === "proposed");
  const isTerminal = status === "done" || status === "abandoned";

  const close = () => {
    setOpen(null);
    router.refresh();
  };

  const oneClick = async (kind: string, payload: Record<string, unknown>) => {
    setActing(true);
    await dispatchAction(kind, payload);
    setActing(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {/* Status actions */}
      <div className="flex flex-wrap gap-2">
        {status === null && (
          <button
            type="button"
            onClick={() => setOpen("schedule")}
            className="rounded border px-3 py-1 text-sm hover:bg-accent"
          >
            Schedule
          </button>
        )}
        {status !== null && ["now", "next", "later"].includes(status) && (
          <button
            type="button"
            disabled={acting}
            onClick={() => oneClick("UNSCHEDULE_PROBLEM", { id: problemId })}
            className="rounded border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
          >
            Unschedule
          </button>
        )}
        {!isTerminal && (
          <button
            type="button"
            disabled={acting}
            onClick={() => oneClick("MARK_PROBLEM_DONE", { id: problemId })}
            className="rounded border px-3 py-1 text-sm hover:bg-accent disabled:opacity-50"
          >
            Mark done
          </button>
        )}
        {status !== "abandoned" && (
          <button
            type="button"
            onClick={() => setOpen("abandon")}
            className="rounded border px-3 py-1 text-sm hover:bg-accent"
          >
            Abandon
          </button>
        )}
      </div>

      {/* Evidence action */}
      <div>
        <button
          type="button"
          onClick={() => setOpen("evidence")}
          className="rounded border px-3 py-1 text-sm hover:bg-accent"
        >
          Link observation
        </button>
      </div>

      {/* Solutions action */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen("solution")}
          className="rounded border px-3 py-1 text-sm hover:bg-accent"
        >
          Add solution
        </button>
        {proposed.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setOpen("decision")}
              className="rounded border px-3 py-1 text-sm hover:bg-accent"
            >
              Record decision
            </button>
            <button
              type="button"
              onClick={() => setOpen("eliminate")}
              className="rounded border px-3 py-1 text-sm hover:bg-accent"
            >
              Eliminate
            </button>
          </>
        )}
      </div>

      {/* Dialogs */}
      <ActionDialog
        kind="SCHEDULE_PROBLEM"
        title="Schedule problem"
        fields={[
          { name: "id", hidden: true, defaultValue: String(problemId) },
          {
            name: "tier",
            label: "tier",
            type: "select",
            required: true,
            options: [
              { value: "now", label: "now" },
              { value: "next", label: "next" },
              { value: "later", label: "later" },
            ],
          },
        ]}
        open={open === "schedule"}
        onClose={close}
      />

      <ActionDialog
        kind="ABANDON_PROBLEM"
        title="Abandon problem"
        fields={[
          { name: "id", hidden: true, defaultValue: String(problemId) },
          { name: "rationale", type: "textarea", required: true },
        ]}
        open={open === "abandon"}
        onClose={close}
      />

      <ActionDialog
        kind="ADD_EVIDENCE"
        title="Link observation as evidence"
        fields={[
          { name: "problem", hidden: true, defaultValue: String(problemId) },
          { name: "observation", label: "observation id (e.g. OBS-001)", required: true },
          { name: "note", label: "why-note (optional)", type: "textarea" },
        ]}
        open={open === "evidence"}
        onClose={close}
      />

      <ActionDialog
        kind="ADD_SOLUTION"
        title="Add solution"
        fields={[
          { name: "problem", hidden: true, defaultValue: String(problemId) },
          { name: "title", required: true },
          { name: "description", type: "textarea" },
        ]}
        open={open === "solution"}
        onClose={close}
      />

      {open === "decision" && proposed.length > 0 && (
        <RecordDecisionModal
          problemId={problemId}
          proposed={proposed}
          onClose={() => setOpen(null)}
        />
      )}

      {open === "eliminate" && proposed.length > 0 && (
        <EliminateModal proposed={proposed} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
