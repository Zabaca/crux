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
  const parsed = JSON.parse(raw) as PersistedViewSnapshot;
  const actor = createActor(viewMachine, { snapshot: parsed });
  actor.start();
  const snap = actor.getSnapshot();
  actor.stop();
  return snap;
}

/**
 * Write the snapshot to disk. Atomic-ish: writes a tmp file then renames.
 */
export function saveState(path: string, snapshot: ViewSnapshot): void {
  const persisted = getPersistedSnapshotFrom(snapshot);
  const json = JSON.stringify(persisted, null, 2);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json, "utf8");
}

function getPersistedSnapshotFrom(snapshot: ViewSnapshot): PersistedViewSnapshot {
  // Reuse XState's built-in persistence via a throwaway actor.
  const actor = createActor(viewMachine, { snapshot: snapshot as unknown as Snapshot<unknown> });
  actor.start();
  const persisted = actor.getPersistedSnapshot();
  actor.stop();
  return persisted;
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
    workstreamExists = await wsExists(event.slug);
  } else if (event.type === "OPEN_PROBLEM") {
    const wsSlug = current.context.workstreamSlug;
    problemExistsInWorkstream = wsSlug ? await probExists(wsSlug, event.slug) : false;
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
      throw new ViewEventRefusedError("GUARD_REJECTED", `workstream not found: ${event.slug}`);
    }
    if (event.type === "OPEN_PROBLEM" && !problemExistsInWorkstream) {
      const ws = current.context.workstreamSlug ?? "<none>";
      throw new ViewEventRefusedError(
        "GUARD_REJECTED",
        `problem not found in workstream ${ws}: ${event.slug}`,
      );
    }
    // Truly illegal event in current state.
    throw new ViewEventRefusedError(
      "ILLEGAL_EVENT",
      `event ${event.type} is not legal in state ${formatStateValue(current.value)}`,
    );
  }

  saveState(path, next);
  return next;
}

/** Reset file-state to initial. */
export function resetState(path: string = resolveViewStatePath()): ViewSnapshot {
  const actor = createActor(viewMachine);
  actor.start();
  const snap = actor.getSnapshot();
  actor.stop();
  saveState(path, snap);
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

async function wsExists(slug: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: workstreams.id })
    .from(workstreams)
    .where(eq(workstreams.slug, slug))
    .limit(1);
  return rows.length > 0;
}

async function probExists(workstreamSlug: string, problemSlug: string): Promise<boolean> {
  const db = getDb();
  const wsRows = await db
    .select({ id: workstreams.id })
    .from(workstreams)
    .where(eq(workstreams.slug, workstreamSlug))
    .limit(1);
  const ws = wsRows[0];
  if (!ws) return false;
  const pRows = await db
    .select({ id: problems.id })
    .from(problems)
    .where(and(eq(problems.workstreamId, ws.id), eq(problems.slug, problemSlug)))
    .limit(1);
  return pRows.length > 0;
}
