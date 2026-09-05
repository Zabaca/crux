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
import { assertKnownKind, kindsOf } from "../kinds.js";
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
import { scopeFor, type Scope } from "../auth/principals.js";
import { assertWriteCapacity, type Capacity } from "../auth/capacity.js";

/** Every action this deployment serves — read off the schema that serves them,
 * both halves of it (ADR-0018). */
const ACTION_KINDS = kindsOf(ActionSchema);

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
    /** The free allowance this Principal writes against (ADR-0013). Required,
     * like the two above: a default here would be an allowance and a claim URL
     * chosen by omission, and the refusal is only useful if it can name the
     * deployment's own way out. */
    capacity: Capacity;
    /** An already-resolved scope for `actor`, when the caller has one — see
     * `query()`. Ignored unless it belongs to this actor. */
    scope?: Scope;
    enforceAllow?: boolean;
  },
): Promise<DispatchResult> {
  // Parse + validate action shape. An unrecognised kind refuses first, and with
  // its own code: it is the deployment being behind the client, not the caller
  // getting an argument wrong (ADR-0018).
  assertKnownKind(rawAction, ACTION_KINDS);
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
  // The Workstream whose data this action touched. Null is a real answer — a
  // navigation back to the Workstream list touches none — and subscribers read
  // it to decide whether the change is in the Workstream they are showing.
  let workstreamId: string | null = null;

  // One scope for the whole dispatch. The view branch needs it as much as the
  // mutation branch does: its guards ask "does this Workstream exist", and an
  // unscoped answer is an existence oracle even though it moves no rows.
  const scope = await scopeFor(options.db, options.actor, options.scope);

  if (isViewAction(action)) {
    // Route through XState machine
    const event = { type: action.kind, ...(action.payload ?? {}) } as ViewEvent;
    const snap = await sendViewEventWithStore(event, { db: options.db, store, scope });
    viewState = snap.value;
    workstreamId = snap.context.workstreamId ?? null;

    // Update meta with new value
    meta.value = snap.value;
    meta.context = snap.context;
  } else {
    // The allowance gate, on the mutation branch only — a corpus write is the
    // only thing ADR-0013 pauses. View actions are navigation and stay open,
    // because blocking them would stop somebody browsing what they already
    // filed, which is the read this cap promises never to touch.
    //
    // Here rather than inside each transition, so a write added later is capped
    // by construction rather than by remembering.
    await assertWriteCapacity(options.db, scope, options.capacity);
    // Route through mutation runner
    const outcome = await runMutation(action, options.db, options.actor, scope);
    result = outcome.result;
    workstreamId = outcome.workstreamId;
  }

  // Persist sidecar fields (re-read: a view action already wrote the snapshot).
  const updatedMeta: ViewMeta = {
    ...meta,
    revision: nextRevision,
    lastAction: { kind: action.kind, ts: Date.now(), workstreamId },
  };
  await store.write(computeSaveViewMetaBlob(await store.read(), updatedMeta));

  return { revision: nextRevision, viewState, result };
}
