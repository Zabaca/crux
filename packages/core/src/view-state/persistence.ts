import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createActor, type Snapshot } from "xstate";
import { getDb } from "../db/client.js";
import { problems, workstreams } from "../db/schema.js";
import { and, eq } from "drizzle-orm";
import { viewMachine, ViewEventSchema, type ViewEvent } from "./machine.js";
import { resolveCruxHome } from "../config/user.js";

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

/**
 * Resolve the path where the view-state JSON lives.
 *
 * Resolution order:
 *   1. `CRUX_VIEW_STATE_PATH` env var (explicit override).
 *   2. `$CRUX_HOME/view-state.json` where CRUX_HOME defaults to `~/.claude/.crux`.
 */
export function resolveViewStatePath(): string {
  if (process.env.CRUX_VIEW_STATE_PATH) {
    return resolve(process.env.CRUX_VIEW_STATE_PATH);
  }
  return join(resolveCruxHome(), "view-state.json");
}

/**
 * Read the persisted snapshot from disk, or return the initial machine state
 * if the file doesn't exist yet. First-read does NOT write — the file is only
 * created on first event.
 */
export function loadState(path: string = resolveViewStatePath()): ViewSnapshot {
  if (!existsSync(path)) {
    // Run the initial transition via a throwaway actor so we get a real snapshot.
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    return snap;
  }
  const raw = readFileSync(path, "utf8");
  let all: Record<string, unknown>;
  try {
    all = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt file — return initial state
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    return snap;
  }
  // Strip sidecar fields before passing to XState — they confuse the state restoration.
  const { revision: _r, lastAction: _la, recentQueries: _rq, ...xstateFields } = all;
  void _r;
  void _la;
  void _rq;
  let parsed = xstateFields as PersistedViewSnapshot;

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
          problemId:
            typeof ctx.problemId === "string"
              ? ctx.problemId
              : typeof ctx.problemSlug === "string"
                ? `PRB-${ctx.problemSlug}`
                : null,
        },
      };
    }
  }

  try {
    const actor = createActor(viewMachine, { snapshot: parsed });
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    return snap;
  } catch {
    // Snapshot incompatible — fall back to initial state
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    return snap;
  }
}

/**
 * Read the current raw JSON at `path`, returning {} on missing/corrupt.
 * Used by both saveState and saveViewMeta to merge new fields against existing.
 */
function readRawOrEmpty(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Atomic-ish write: tmp file + rename.
 */
function atomicWrite(path: string, payload: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  // node:fs.renameSync handles cross-tmp on same fs; we mkdir parent first
  const fs = require("node:fs") as typeof import("node:fs");
  fs.renameSync(tmp, path);
}

/**
 * Write the XState snapshot to disk. Merges into the existing file so sidecar
 * fields (revision, lastAction, recentQueries) survive the write.
 *
 * If `opts.lastActionKind` is provided, also stamps a fresh
 * `lastAction: { kind, ts }` and bumps `revision++` — used by sendViewEvent so
 * the SSE listener can branch ViewAction vs MutationAction. Without it,
 * existing sidecar fields are carried through unchanged.
 */
export function saveState(
  path: string,
  snapshot: ViewSnapshot,
  opts: { lastActionKind?: string } = {},
): void {
  const persisted = getPersistedSnapshotFrom(snapshot) as unknown as Record<string, unknown>;
  const existing = readRawOrEmpty(path);
  const stampLastAction = typeof opts.lastActionKind === "string";
  const merged: Record<string, unknown> = {
    ...persisted,
    revision: stampLastAction
      ? (typeof existing.revision === "number" ? existing.revision : 0) + 1
      : (existing.revision ?? 0),
    lastAction: stampLastAction
      ? { kind: opts.lastActionKind, ts: Date.now() }
      : (existing.lastAction ?? null),
    recentQueries: existing.recentQueries ?? [],
  };
  atomicWrite(path, merged);
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
 * Load the full ViewMeta from disk (migrate-tolerant: defaults revision:0, lastAction:null, recentQueries:[]).
 *
 * Extracts `value` and `context` directly from the raw JSON rather than via XState actor
 * restoration to avoid XState errors on corrupt or sidecar-only files.
 *
 * Migrates legacy workstreamSlug/problemSlug to workstreamId/problemId on read.
 */
export function loadViewMeta(path?: string): ViewMeta {
  const resolvedPath = path ?? resolveViewStatePath();
  if (!existsSync(resolvedPath)) {
    return {
      value: DEFAULT_VALUE,
      context: DEFAULT_CONTEXT,
      revision: 0,
      lastAction: null,
      recentQueries: [],
    };
  }
  const raw = readFileSync(resolvedPath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
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
        problemId:
          (rawContext.problemId as string | null) ??
          (typeof rawContext.problemSlug === "string" ? `PRB-${rawContext.problemSlug}` : null),
      }
    : DEFAULT_CONTEXT;

  return {
    value,
    context,
    revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    lastAction: (parsed.lastAction as LastAction | null) ?? null,
    recentQueries: Array.isArray(parsed.recentQueries)
      ? (parsed.recentQueries as RecentQuery[])
      : [],
  };
}

/**
 * Save ViewMeta to disk. Merges sidecar fields (revision, lastAction, recentQueries)
 * over the existing JSON so XState fields (value, context, status, historyValue,
 * children) survive the write.
 *
 * Caller's `meta.value` / `meta.context` are NOT written here — those belong to the
 * XState write path (saveState via sendViewEvent). This function only owns sidecar.
 */
export function saveViewMeta(meta: ViewMeta, path?: string): void {
  const resolvedPath = path ?? resolveViewStatePath();
  const existing = readRawOrEmpty(resolvedPath);
  const merged: Record<string, unknown> = {
    ...existing,
    revision: meta.revision,
    lastAction: meta.lastAction,
    recentQueries: meta.recentQueries,
  };
  atomicWrite(resolvedPath, merged);
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
export async function sendViewEvent(
  event: ViewEvent,
  options: { path?: string } = {},
): Promise<ViewSnapshot> {
  const parsed = ViewEventSchema.safeParse(event);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "event"}: ${i.message}`)
      .join("; ");
    throw new ViewEventRefusedError("INVALID_PAYLOAD", msg);
  }

  const path = options.path ?? resolveViewStatePath();
  const current = loadState(path);

  // Async-validate guards against the db before entering XState.
  let workstreamExists = false;
  let problemExistsInWorkstream = false;

  if (event.type === "SELECT_WORKSTREAM") {
    workstreamExists = await wsExists(event.id);
  } else if (event.type === "OPEN_PROBLEM") {
    const wsId = current.context.workstreamId;
    problemExistsInWorkstream = wsId ? await probExists(wsId, event.id) : false;
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

  saveState(path, next, { lastActionKind: event.type });
  return next;
}

/** Reset file-state to initial. */
export function resetState(path: string = resolveViewStatePath()): ViewSnapshot {
  const actor = createActor(viewMachine);
  actor.start();
  const snap = actor.getSnapshot();
  actor.stop();
  saveState(path, snap, { lastActionKind: "RESET" });
  return snap;
}

/** Legal event types from the current snapshot. */
export function nextEvents(snapshot: ViewSnapshot): string[] {
  // XState v5 doesn't expose `nextEvents` on snapshots anymore; derive by probing
  // the machine's state node for `on` handlers. Use internal path resolution.
  const value = snapshot.value;
  const leaf = leafStateId(value);
  const def = viewMachine.definition;
  const node = resolveStateNode(def, leaf);
  if (!node) return [];
  const on = (node as { on?: Record<string, unknown> }).on ?? {};
  return Object.keys(on);
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

function leafStateId(value: ViewSnapshot["value"]): string {
  return formatStateValue(value);
}

type StateNodeLike = {
  states?: Record<string, StateNodeLike>;
  on?: Record<string, unknown>;
};

function resolveStateNode(root: StateNodeLike, dotted: string): StateNodeLike | null {
  const parts = dotted.split(".");
  let cur: StateNodeLike | undefined = root;
  for (const p of parts) {
    if (!cur?.states?.[p]) return null;
    cur = cur.states[p];
  }
  return cur ?? null;
}

function sameState(a: ViewSnapshot, b: ViewSnapshot): boolean {
  return (
    JSON.stringify(a.value) === JSON.stringify(b.value) &&
    JSON.stringify(a.context) === JSON.stringify(b.context)
  );
}

// --- db-backed guard helpers ---

async function wsExists(id: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: workstreams.id })
    .from(workstreams)
    .where(eq(workstreams.id, id))
    .limit(1);
  return rows.length > 0;
}

async function probExists(workstreamId: string, problemId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.workstreamId, workstreamId), eq(problems.id, problemId)))
    .limit(1);
  return rows.length > 0;
}
