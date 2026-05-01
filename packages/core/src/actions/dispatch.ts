/**
 * dispatch(action) — the single entry point for all Crux actions.
 *
 * Behavior:
 *  1. Load current view snapshot (revision, lastAction, recentQueries sidecar).
 *  2. Resolve allowedActions for current view + globals.
 *  3. If action.kind ∉ allowed AND CRUX_COLLAB=1 → throw ActionNotAllowedError.
 *     (If CRUX_COLLAB is absent, fall through — today's direct mode.)
 *  4. Branch:
 *     ViewAction:     sendViewEvent → persists view-state with new value/context.
 *     MutationAction: call existing transition via runMutation().
 *  5. Bump revision, write sidecar fields into view-state.json.
 *  6. Return { revision, viewState?, result? }.
 */
import { ActionSchema, isViewAction, type Action } from "./schemas.js";
import { isActionAllowed, getAllowedActions } from "./allowed.js";
import {
  loadViewMeta,
  saveViewMeta,
  sendViewEvent,
  type ViewMeta,
} from "../view-state/persistence.js";
import type { ViewEvent } from "../view-state/machine.js";
import { runMutation } from "./mutations.js";

/** Error thrown when an action is not allowed in the current view state. */
export class ActionNotAllowedError extends Error {
  code: "ACTION_NOT_ALLOWED" = "ACTION_NOT_ALLOWED";
  state: unknown;
  attempted: string;
  allowedView: string[];
  allowedMutation: string[];
  globals: string[];

  constructor(
    state: unknown,
    attempted: string,
    allowed: { allowedView: string[]; allowedMutation: string[]; globals: string[] },
  ) {
    super(`action ${attempted} is not allowed in state ${JSON.stringify(state)}`);
    this.name = "ActionNotAllowedError";
    this.state = state;
    this.attempted = attempted;
    this.allowedView = allowed.allowedView;
    this.allowedMutation = allowed.allowedMutation;
    this.globals = allowed.globals;
  }
}

export type DispatchResult = {
  revision: number;
  viewState?: unknown;
  result?: unknown;
};

/**
 * Dispatch an action. Validates shape, enforces allowed list (when CRUX_COLLAB=1),
 * routes to view machine or transition, bumps revision, and persists sidecar.
 */
export async function dispatch(
  rawAction: unknown,
  options: { path?: string; enforceAllow?: boolean } = {},
): Promise<DispatchResult> {
  // Parse + validate action shape
  const action = ActionSchema.parse(rawAction) as Action;

  // Load current meta (revision, lastAction, recentQueries) + view state value
  const meta = loadViewMeta(options.path);

  // Enforce allowed list when explicitly requested OR when collab mode is on.
  // CLI keeps env-flag gating; UI passes enforceAllow=true unconditionally.
  const collabMode = options.enforceAllow === true || process.env.CRUX_COLLAB === "1";
  if (collabMode) {
    if (!isActionAllowed(action.kind, meta.value)) {
      const allowed = getAllowedActions(meta.value);
      throw new ActionNotAllowedError(meta.value, action.kind, {
        allowedView: allowed.allowedView,
        allowedMutation: allowed.allowedMutation,
        globals: allowed.globals as string[],
      });
    }
  }

  const nextRevision = (meta.revision ?? 0) + 1;
  let result: unknown = undefined;
  let viewState: unknown = undefined;

  if (isViewAction(action)) {
    // Route through XState machine
    const event = { type: action.kind, ...(action.payload ?? {}) } as ViewEvent;
    const snap = await sendViewEvent(event, options);
    viewState = snap.value;

    // Update meta with new value
    meta.value = snap.value;
    meta.context = snap.context;
  } else {
    // Route through mutation runner
    result = await runMutation(action);
  }

  // Persist sidecar fields
  const updatedMeta: ViewMeta = {
    ...meta,
    revision: nextRevision,
    lastAction: { kind: action.kind, ts: Date.now() },
  };
  saveViewMeta(updatedMeta, options.path);

  return { revision: nextRevision, viewState, result };
}
