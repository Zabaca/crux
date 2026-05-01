/**
 * Collab-mode guard + mutation recorder for CLI mutation commands.
 *
 * `guardAction(kind)` — call BEFORE the transition. When CRUX_COLLAB=1,
 *   throws ActionNotAllowedError if the kind is not permitted in current view.
 *   When CRUX_COLLAB is absent, no-op.
 *
 * `recordMutation(kind)` — call AFTER the transition succeeds. UNCONDITIONAL
 *   (independent of CRUX_COLLAB): bumps `revision` and writes `lastAction`
 *   into view-state.json. This is what triggers the web UI's SSE listener
 *   to call `router.refresh()` for data invalidation.
 */
import { isActionAllowed, ActionNotAllowedError, getAllowedActions } from "@crux/core/actions";
import { loadState, loadViewMeta, saveViewMeta } from "@crux/core/view-state";

/**
 * Call at the top of any mutation CLI command handler.
 * Throws ActionNotAllowedError (caught by handleError → exit 25) if the
 * action is not permitted in the current view state and CRUX_COLLAB=1.
 */
export function guardAction(kind: string): void {
  if (process.env.CRUX_COLLAB !== "1") return;
  const snap = loadState();
  if (!isActionAllowed(kind, snap.value)) {
    const allowed = getAllowedActions(snap.value);
    throw new ActionNotAllowedError(snap.value, kind, {
      allowedView: allowed.allowedView,
      allowedMutation: allowed.allowedMutation,
      globals: allowed.globals as string[],
    });
  }
}

/**
 * Call AFTER a mutation succeeds. Unconditionally bumps revision and writes
 * lastAction into view-state.json so the web UI's SSE listener fires
 * router.refresh() for data invalidation.
 *
 * Best-effort: failures are swallowed so a successful DB mutation never
 * surfaces as an error to the user because of view-state bookkeeping.
 */
export function recordMutation(kind: string): void {
  try {
    const meta = loadViewMeta();
    meta.revision = (meta.revision ?? 0) + 1;
    meta.lastAction = { kind, ts: Date.now() };
    saveViewMeta(meta);
  } catch {
    // Best-effort — never fail a mutation on view-state bookkeeping
  }
}
