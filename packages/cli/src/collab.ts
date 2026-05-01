/**
 * Collab-mode guard for CLI mutation commands.
 *
 * When CRUX_COLLAB=1, checks that the given action kind is allowed in the
 * current view state. Throws ActionNotAllowedError if not.
 * When CRUX_COLLAB is absent, this is a no-op (direct mode).
 */
import { isActionAllowed, ActionNotAllowedError, getAllowedActions } from "@crux/core/actions";
import { loadState } from "@crux/core/view-state";

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
