"use client";

import { useEffect, useRef, useState } from "react";
import { dispatchAction, type ActionResponse } from "@/lib/dispatch-action";

export type FieldSpec = {
  name: string;
  label?: string;
  type?: "text" | "textarea";
  required?: boolean;
  defaultValue?: string;
  /** Hidden field — pre-filled from page context, not editable. */
  hidden?: boolean;
};

type Props = {
  kind: string;
  title: string;
  fields: FieldSpec[];
  open: boolean;
  onClose: () => void;
  /** Optional payload transformer; default builds string keys from field names, drops blanks for optional fields. */
  transform?: (values: Record<string, string>) => Record<string, unknown>;
};

export function ActionDialog({ kind, title, fields, open, onClose, transform }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ActionResponse | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const values: Record<string, string> = {};
    for (const f of fields) {
      const v = (fd.get(f.name) as string | null) ?? "";
      values[f.name] = v;
    }
    const payload = transform
      ? transform(values)
      : Object.fromEntries(
          fields
            .filter((f) => f.required || values[f.name] !== "")
            .map((f) => [f.name, values[f.name]]),
        );
    const res = await dispatchAction(kind, payload);
    setSubmitting(false);
    if (res.ok) {
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
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="font-mono text-xs text-muted-foreground">{kind}</span>
        </div>
        <div className="space-y-3">
          {fields.map((f) =>
            f.hidden ? (
              <input key={f.name} type="hidden" name={f.name} defaultValue={f.defaultValue ?? ""} />
            ) : (
              <label key={f.name} className="block space-y-1">
                <span className="text-xs font-medium">
                  {f.label ?? f.name}
                  {f.required ? <span className="text-red-600"> *</span> : null}
                </span>
                {f.type === "textarea" ? (
                  <textarea
                    name={f.name}
                    defaultValue={f.defaultValue ?? ""}
                    required={f.required}
                    rows={4}
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                  />
                ) : (
                  <input
                    name={f.name}
                    type="text"
                    defaultValue={f.defaultValue ?? ""}
                    required={f.required}
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                  />
                )}
              </label>
            ),
          )}
        </div>
        {error && !error.ok ? (
          <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900 space-y-1">
            <div className="font-mono">{error.code}</div>
            <div>{error.message}</div>
            {error.code === "ACTION_NOT_ALLOWED" && error.allowed ? (
              <div>
                <div className="font-medium">Allowed here:</div>
                <ul className="font-mono">
                  {error.allowed.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}
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
