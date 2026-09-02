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
import type { CruxDb } from "../db/client.js";
import { isActionAllowed, getAllowedActions } from "./allowed.js";
import {
  computeSaveViewMetaBlob,
  loadViewMetaFromBlob,
  sendViewEventWithStore,
  type ViewMeta,
} from "../view-state/persistence.js";
import type { ViewStore } from "../view-state/store.js";
import type { ViewEvent } from "../view-state/machine.js";
import { runMutation, type Actor } from "./mutations.js";
import { resolveScope } from "../auth/principals.js";

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
  options: {
    db: CruxDb;
    /** Where view-state lives. Required: a default here would be a storage
     * medium chosen by omission, and the filesystem one is what put `node:fs`
     * in the Worker bundle. */
    viewStore: ViewStore;
    /** Who the write is attributed to, and whose corpus it may touch. Required
     * for the same reason — and it is the *Principal*, resolved server-side, so
     * the tenancy boundary is the same one `query()` enforces (ADR-0013). */
    actor: Actor;
    enforceAllow?: boolean;
  },
): Promise<DispatchResult> {
  // Parse + validate action shape
  const action = ActionSchema.parse(rawAction) as Action;

  const store = options.viewStore;

  // Load current meta (revision, lastAction, recentQueries) + view state value
  const meta = loadViewMetaFromBlob(await store.read());

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

  // One scope for the whole dispatch. The view branch needs it as much as the
  // mutation branch does: its guards ask "does this Workstream exist", and an
  // unscoped answer is an existence oracle even though it moves no rows.
  const scope = await resolveScope(options.db, options.actor);

  if (isViewAction(action)) {
    // Route through XState machine
    const event = { type: action.kind, ...(action.payload ?? {}) } as ViewEvent;
    const snap = await sendViewEventWithStore(event, { db: options.db, store, scope });
    viewState = snap.value;

    // Update meta with new value
    meta.value = snap.value;
    meta.context = snap.context;
  } else {
    // Route through mutation runner
    result = await runMutation(action, options.db, options.actor, scope);
  }

  // Persist sidecar fields (re-read: a view action already wrote the snapshot).
  const updatedMeta: ViewMeta = {
    ...meta,
    revision: nextRevision,
    lastAction: { kind: action.kind, ts: Date.now() },
  };
  await store.write(computeSaveViewMetaBlob(await store.read(), updatedMeta));

  return { revision: nextRevision, viewState, result };
}
