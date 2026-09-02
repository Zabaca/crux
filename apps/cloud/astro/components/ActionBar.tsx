/**
 * Contextual page actions — the dialog carried over from the Next.js app as an
 * island (ADR-0004). Its shape is unchanged: a `<dialog>`, a field spec per
 * action, one `dispatchAction` on submit, and the server's refusal rendered in
 * place rather than swallowed.
 *
 * What each page offers is decided on the server and handed in as `actions`,
 * because "which actions belong here" is a property of the entity, not of the
 * browser — the Problem page offers ADD_ATTEMPT, the Workstream board offers
 * ADD_PROBLEM, and neither offers what the other does.
 */
import { useEffect, useRef, useState } from "react";

import { dispatchAction, type DispatchFailure } from "../lib/dispatch.js";

export type FieldSpec = {
  name: string;
  label?: string;
  type?: "text" | "textarea" | "select";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  /** Filled from page context and not editable — the Problem this is filed on. */
  fixed?: string;
  /** Send as a number (entity ids are numeric for everything but Observation). */
  asNumber?: boolean;
};

export type ActionSpec = {
  kind: string;
  label: string;
  fields: FieldSpec[];
};

function coerce(field: FieldSpec, value: string): unknown {
  return field.asNumber ? Number(value) : value;
}

function Dialog({ action, onDone }: { action: ActionSpec; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<DispatchFailure | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    for (const field of action.fields) {
      const raw = field.fixed ?? String(form.get(field.name) ?? "");
      if (raw === "" && !field.required) continue;
      payload[field.name] = coerce(field, raw);
    }

    const res = await dispatchAction(action.kind, payload);
    setSubmitting(false);
    if (!res.ok) {
      setError(res);
      return;
    }
    // The page is server-rendered, so showing the new entity means re-reading
    // the page. The island holds no copy of the corpus to update.
    location.reload();
  }

  return (
    <dialog ref={ref} onClose={onDone} className="panel" style={{ maxWidth: 460, width: "100%" }}>
      <form className="pad form" onSubmit={onSubmit} style={{ maxWidth: "none" }}>
        <div className="row-inline">
          <h2 style={{ margin: 0 }}>{action.label}</h2>
          <span className="mono" style={{ marginLeft: "auto", fontSize: 11 }}>
            {action.kind}
          </span>
        </div>

        {action.fields
          .filter((f) => f.fixed === undefined)
          .map((f) => (
            <label key={f.name}>
              {f.label ?? f.name}
              {f.required ? " *" : ""}
              {f.type === "textarea" ? (
                <textarea name={f.name} required={f.required} rows={4} />
              ) : f.type === "select" ? (
                <select name={f.name} required={f.required}>
                  {!f.required ? <option value="">— select —</option> : null}
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input name={f.name} type="text" required={f.required} />
              )}
            </label>
          ))}

        {error ? (
          <div className="notice bad" style={{ marginTop: 16 }}>
            <div className="mono">{error.code}</div>
            <div>{error.message}</div>
            {error.allowed ? (
              <div className="mono" style={{ marginTop: 6 }}>
                allowed here: {error.allowed.join(", ")}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="row-inline" style={{ marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" className="btn plain" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={submitting}>
            {submitting ? "…" : "File it"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default function ActionBar({ actions }: { actions: ActionSpec[] }) {
  const [open, setOpen] = useState<ActionSpec | null>(null);
  return (
    <div className="row-inline" style={{ margin: "6px 0 22px" }}>
      {actions.map((a) => (
        <button key={a.kind} type="button" className="btn plain" onClick={() => setOpen(a)}>
          {a.label}
        </button>
      ))}
      {open ? <Dialog action={open} onDone={() => setOpen(null)} /> : null}
    </div>
  );
}
