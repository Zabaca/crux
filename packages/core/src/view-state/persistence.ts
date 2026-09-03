import { createActor, type Snapshot } from "xstate";
import type { CruxDb } from "../db/client.js";
import { problems, workstreams } from "../db/schema.js";
import { and, eq, inArray } from "drizzle-orm";
import type { Scope } from "../auth/principals.js";
import { viewMachine, ViewEventSchema, type ViewEvent } from "./machine.js";
import type { ViewBlob, ViewStore } from "./store.js";

type ViewSnapshot = ReturnType<ReturnType<typeof createActor<typeof viewMachine>>["getSnapshot"]>;
type PersistedViewSnapshot = ReturnType<
  ReturnType<typeof createActor<typeof viewMachine>>["getPersistedSnapshot"]
>;

/** Sidecar fields stored alongside the XState persisted snapshot. */
export type RecentQuery = {
  kind: string;
  slug?: string;
  ts: number;
};

export type LastAction = {
  kind: string;
  ts: number;
  /**
   * The Workstream whose data the action touched, or null when it touched none
   * — navigating back to the Workstream list, or a RESET. Every mutation
   * touches one, including the one that creates it.
   *
   * This is what lets a subscriber decide whether an event is theirs. Without
   * it every open page refetches on any action anywhere in the Principal's
   * corpus, which with agents working several Workstreams in parallel is noise
   * rather than freshness.
   */
  workstreamId: string | null;
};

/**
 * ViewMeta: the full view-state.json shape.
 * XState fields are nested under `xstate`; sidecar fields are top-level.
 * When loading legacy files (no revision/lastAction/recentQueries), we default.
 */
export type ViewMeta = {
  /** XState persisted snapshot (opaque) */
  xstate?: PersistedViewSnapshot;
  /** Derived from xstate snapshot: current machine value */
  value: unknown;
  /** Derived from xstate snapshot: current machine context */
  context: { workstreamId: string | null; problemId: string | null };
  revision: number;
  lastAction: LastAction | null;
  recentQueries: RecentQuery[];
};

/** Initial machine snapshot from a throwaway actor. */
function initialSnapshot(): ViewSnapshot {
  const actor = createActor(viewMachine);
  actor.start();
  const snap = actor.getSnapshot();
  actor.stop();
  return snap;
}

/**
 * Pure counterpart of `loadState`: restore an XState snapshot from an already-read
 * blob. A blob with no usable state value — missing/corrupt storage, or one
 * holding only sidecar fields — yields the initial state. No fs.
 */
export function loadStateFromBlob(all: ViewBlob): ViewSnapshot {
  if (!all) return initialSnapshot();
  // Strip sidecar fields before passing to XState — they confuse the state restoration.
  const { revision: _r, lastAction: _la, recentQueries: _rq, ...xstateFields } = all;
  void _r;
  void _la;
  void _rq;
  // The guard is on a usable state value, not on the blob being non-empty: a
  // blob holding only sidecars is not empty, and a recorded read writes exactly
  // that for a Principal that has never moved its view. Handing XState a
  // snapshot with no `value` makes it enumerate `undefined` — which it swallows
  // into an errored snapshot and rethrows from a `setTimeout`, on a later tick,
  // where the try/catch below cannot reach it. In workerd that takes the
  // isolate with it.
  if (xstateFields.value === undefined) return initialSnapshot();
  // Normalize: XState v5 requires status/children/historyValue; old files omit them.
  // XState types a persisted snapshot as `Snapshot<unknown>`, which has no
  // `context` — but the machine's own context is exactly what has to be
  // migrated here, so this stays a loose record until it is handed back.
  let parsed: Record<string, unknown> = {
    status: "active",
    historyValue: {},
    children: {},
    ...xstateFields,
  };

  // Migrate legacy context fields from slugs to IDs.
  if (parsed.context && typeof parsed.context === "object") {
    const ctx = parsed.context as Record<string, unknown>;
    if ("workstreamSlug" in ctx || "problemSlug" in ctx) {
      parsed = {
        ...parsed,
        context: {
          workstreamId:
            typeof ctx.workstreamId === "string"
              ? ctx.workstreamId
              : typeof ctx.workstreamSlug === "string"
                ? `WS-${ctx.workstreamSlug}`
                : null,
          problemId: typeof ctx.problemId === "string" ? ctx.problemId : null,
        },
      };
    }
  }

  try {
    const actor = createActor(viewMachine, {
      snapshot: parsed as unknown as PersistedViewSnapshot,
    });
    // XState does not throw out of `createActor` when a snapshot is
    // unrestorable — it stores an errored snapshot and rethrows the cause from
    // a `setTimeout` the moment the actor is started. So the errored snapshot
    // is checked here, before starting, which is the only point where that
    // deferred throw can still be prevented rather than caught.
    if (actor.getSnapshot().status === "error") return initialSnapshot();
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    if (!snap.context || typeof snap.context !== "object") {
      throw new Error("restored snapshot missing context");
    }
    return snap;
  } catch {
    // Snapshot incompatible — fall back to initial state
    return initialSnapshot();
  }
}

/**
 * Merge a snapshot over an existing blob and return the blob to persist.
 *
 * If `opts.lastActionKind` is provided, also stamps a fresh
 * `lastAction: { kind, ts, workstreamId }` and bumps `revision++` — used by
 * sendViewEvent so the SSE listener can branch ViewAction vs MutationAction and
 * tell whether the change is in the Workstream it is showing. Without it,
 * existing sidecar fields are carried through unchanged.
 */
export function computeSaveStateBlob(
  existing: ViewBlob,
  snapshot: ViewSnapshot,
  opts: { lastActionKind?: string; lastActionWorkstreamId?: string | null } = {},
): ViewBlob {
  const persisted = getPersistedSnapshotFrom(snapshot) as unknown as Record<string, unknown>;
  const stampLastAction = typeof opts.lastActionKind === "string";
  return {
    ...persisted,
    revision: stampLastAction
      ? (typeof existing.revision === "number" ? existing.revision : 0) + 1
      : (existing.revision ?? 0),
    lastAction: stampLastAction
      ? {
          kind: opts.lastActionKind,
          ts: Date.now(),
          workstreamId: opts.lastActionWorkstreamId ?? null,
        }
      : (existing.lastAction ?? null),
    recentQueries: existing.recentQueries ?? [],
  };
}

function getPersistedSnapshotFrom(snapshot: ViewSnapshot): PersistedViewSnapshot {
  // Reuse XState's built-in persistence via a throwaway actor.
  const actor = createActor(viewMachine, { snapshot: snapshot as unknown as Snapshot<unknown> });
  actor.start();
  const persisted = actor.getPersistedSnapshot();
  actor.stop();
  return persisted;
}

/** Default ViewContext when no state is available. */
const DEFAULT_CONTEXT: ViewMeta["context"] = { workstreamId: null, problemId: null };
/** Default XState initial value (nested object from machine definition). */
const DEFAULT_VALUE = { viewing: "workstream_list" };

/**
 * Derive the full ViewMeta from an already-read blob (migrate-tolerant: defaults
 * revision:0, lastAction:null, recentQueries:[]).
 *
 * Extracts `value` and `context` directly from the raw JSON rather than via XState actor
 * restoration to avoid XState errors on corrupt or sidecar-only blobs.
 *
 * Migrates legacy workstreamSlug/problemSlug to workstreamId/problemId on read.
 */
export function loadViewMetaFromBlob(parsed: ViewBlob): ViewMeta {
  if (!parsed || Object.keys(parsed).length === 0) {
    return {
      value: DEFAULT_VALUE,
      context: DEFAULT_CONTEXT,
      revision: 0,
      lastAction: null,
      recentQueries: [],
    };
  }
  // Extract value and context directly from the raw JSON (XState persists them at top-level).
  const value = parsed.value ?? DEFAULT_VALUE;

  // Migrate legacy slug-based context to ID-based context.
  const rawContext = parsed.context as Record<string, unknown> | undefined;
  const context: ViewMeta["context"] = rawContext
    ? {
        workstreamId:
          (rawContext.workstreamId as string | null) ??
          (typeof rawContext.workstreamSlug === "string"
            ? `WS-${rawContext.workstreamSlug}`
            : null),
        problemId: (rawContext.problemId as string | null) ?? null,
      }
    : DEFAULT_CONTEXT;

  return {
    value,
    context,
    revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    lastAction: normalizeLastAction(parsed.lastAction),
    recentQueries: Array.isArray(parsed.recentQueries)
      ? (parsed.recentQueries as RecentQuery[])
      : [],
  };
}

/**
 * A blob written before `workstreamId` existed has a `lastAction` without one.
 * It reads as `null` — "touched no Workstream" — rather than as absent, so
 * every consumer sees the same shape and the field is purely additive.
 */
function normalizeLastAction(raw: unknown): LastAction | null {
  if (!raw || typeof raw !== "object") return null;
  const la = raw as Record<string, unknown>;
  return {
    // Spread first so a field a newer writer added survives the read; the
    // three below are the ones this type promises, so they win.
    ...la,
    kind: String(la.kind ?? ""),
    ts: typeof la.ts === "number" ? la.ts : 0,
    workstreamId: typeof la.workstreamId === "string" ? la.workstreamId : null,
  };
}

/**
 * Merge sidecar fields (revision, lastAction, recentQueries) over an existing
 * blob so XState fields (value, context, status, historyValue, children) survive
 * the write, and return the blob to persist.
 *
 * Caller's `meta.value` / `meta.context` are NOT written here — those belong to the
 * XState write path (computeSaveStateBlob via sendViewEventWithStore).
 */
export function computeSaveViewMetaBlob(existing: ViewBlob, meta: ViewMeta): ViewBlob {
  return {
    ...existing,
    revision: meta.revision,
    lastAction: meta.lastAction,
    recentQueries: meta.recentQueries,
  };
}

/** Error thrown when a view event is refused by a guard or illegal in the current state. */
export class ViewEventRefusedError extends Error {
  code: "INVALID_PAYLOAD" | "GUARD_REJECTED" | "ILLEGAL_EVENT";
  constructor(code: "INVALID_PAYLOAD" | "GUARD_REJECTED" | "ILLEGAL_EVENT", message: string) {
    super(message);
    this.name = "ViewEventRefusedError";
    this.code = code;
  }
}

/**
 * Validate async preconditions (db lookups) for the given event + current state,
 * then run the sync transition with pre-computed boolean guards and persist.
 *
 * Throws `ViewEventRefusedError` if the event is illegal or a guard refuses.
 */
export async function sendViewEventWithStore(
  event: ViewEvent,
  options: { db: CruxDb; store: ViewStore; scope: Scope },
): Promise<ViewSnapshot> {
  const parsed = ViewEventSchema.safeParse(event);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "event"}: ${i.message}`)
      .join("; ");
    throw new ViewEventRefusedError("INVALID_PAYLOAD", msg);
  }

  const blob = await options.store.read();
  const current = loadStateFromBlob(blob);

  // Async-validate guards against the db before entering XState.
  let workstreamExists = false;
  let problemExistsInWorkstream = false;

  if (event.type === "SELECT_WORKSTREAM") {
    workstreamExists = await wsExists(event.id, options.db, options.scope);
  } else if (event.type === "OPEN_PROBLEM") {
    const wsId = current.context.workstreamId;
    problemExistsInWorkstream = wsId
      ? await probExists(wsId, event.id, options.db, options.scope)
      : false;
  }

  const machineWithGuards = viewMachine.provide({
    guards: {
      workstreamExists: () => workstreamExists,
      problemExistsInWorkstream: () => problemExistsInWorkstream,
    },
  });

  // Rehydrate into a fresh actor with the guards-provided machine, send the
  // event, and take the resulting snapshot. (getNextSnapshot doesn't honor
  // `.provide`'d guards reliably in XState v5.30.)
  const persisted = getPersistedSnapshotFrom(current);
  const actor = createActor(machineWithGuards, {
    snapshot: persisted as unknown as Snapshot<unknown>,
  });
  actor.start();
  actor.send(event);
  const next = actor.getSnapshot();
  actor.stop();

  // If nothing changed and the event had a guard, we refused.
  if (sameState(current, next)) {
    if (event.type === "SELECT_WORKSTREAM" && !workstreamExists) {
      throw new ViewEventRefusedError("GUARD_REJECTED", `workstream not found: ${event.id}`);
    }
    if (event.type === "OPEN_PROBLEM" && !problemExistsInWorkstream) {
      const ws = current.context.workstreamId ?? "<none>";
      throw new ViewEventRefusedError(
        "GUARD_REJECTED",
        `problem not found in workstream ${ws}: ${event.id}`,
      );
    }
    // Truly illegal event in current state.
    throw new ViewEventRefusedError(
      "ILLEGAL_EVENT",
      `event ${event.type} is not legal in state ${formatStateValue(current.value)}`,
    );
  }

  await options.store.write(
    computeSaveStateBlob(blob, next, {
      lastActionKind: event.type,
      // A view event's Workstream is wherever the machine ended up pointing —
      // which is null once it is back at the Workstream list.
      lastActionWorkstreamId: next.context.workstreamId ?? null,
    }),
  );
  return next;
}

export function formatStateValue(value: ViewSnapshot["value"]): string {
  if (typeof value === "string") return value;
  const parts: string[] = [];
  let cur: unknown = value;
  while (cur && typeof cur === "object") {
    const obj = cur as Record<string, unknown>;
    const key = Object.keys(obj)[0];
    if (!key) break;
    parts.push(key);
    cur = obj[key];
  }
  if (typeof cur === "string") parts.push(cur);
  return parts.join(".");
}

function sameState(a: ViewSnapshot, b: ViewSnapshot): boolean {
  return (
    JSON.stringify(a.value) === JSON.stringify(b.value) &&
    JSON.stringify(a.context) === JSON.stringify(b.context)
  );
}

// --- db-backed guard helpers ---

/**
 * These two answer "does it exist" and are therefore scoped like every read.
 *
 * A guard that looked at the whole database would refuse a selection of another
 * Principal's Workstream by *permitting* it, and refuse a nonexistent one with
 * `GUARD_REJECTED` — two different answers, which is an existence oracle for
 * the deployment. Scoping the lookup makes somebody else's Workstream and a
 * Workstream that never existed the same answer, which is the rule the read
 * layer already follows (ADR-0013).
 */
async function wsExists(id: string, db: CruxDb, scope: Scope): Promise<boolean> {
  const rows = await db
    .select({ id: workstreams.id })
    .from(workstreams)
    .where(and(eq(workstreams.id, id), inArray(workstreams.id, scope.workstreamIds)))
    .limit(1);
  return rows.length > 0;
}

async function probExists(
  workstreamId: string,
  problemId: string,
  db: CruxDb,
  scope: Scope,
): Promise<boolean> {
  const numId = parseInt(problemId, 10);
  if (isNaN(numId)) return false;
  if (!scope.has(workstreamId)) return false;
  const rows = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.workstreamId, workstreamId), eq(problems.id, numId)))
    .limit(1);
  return rows.length > 0;
}
