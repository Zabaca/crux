/**
 * Persistence merge tests — both write paths must preserve the other's fields.
 *
 * Bug 1 (regression): saveState (via sendViewEvent) wrote only XState fields,
 *   stripping sidecar (revision, lastAction, recentQueries).
 * Bug 2 (regression): saveViewMeta wrote only sidecar fields, stripping XState
 *   value/context/status/historyValue/children.
 *
 * Fix: every write merges against current file contents.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createActor } from "xstate";
import { loadViewMeta, saveState, saveViewMeta } from "./persistence.js";
import { viewMachine } from "./machine.js";

// We can't drive the XState path easily without a workstreams row, so we
// test the merge invariant at the persistence layer using saveViewMeta
// against a hand-written XState file, and assert XState fields survive.

let tmpDir: string;
let viewStatePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "crux-persist-"));
  viewStatePath = join(tmpDir, "view-state.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function readRaw(): Record<string, unknown> {
  if (!existsSync(viewStatePath)) return {};
  return JSON.parse(readFileSync(viewStatePath, "utf8")) as Record<string, unknown>;
}

describe("persistence merge: saveViewMeta preserves XState fields", () => {
  test("saveViewMeta over a file with XState fields preserves value/context/status", () => {
    // Hand-write a fully populated XState file
    const xstateJson = {
      status: "active",
      value: { viewing: "workstream_dashboard" },
      context: { workstreamSlug: "crux", problemSlug: null },
      historyValue: {},
      children: {},
    };
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(viewStatePath, JSON.stringify(xstateJson, null, 2), "utf8");

    // Save sidecar-only meta — should not strip XState fields
    saveViewMeta(
      {
        value: { viewing: "workstream_list" }, // intentionally wrong — should be ignored
        context: { workstreamSlug: null, problemSlug: null },
        revision: 1,
        lastAction: { kind: "ADD_PROBLEM", ts: 1234567890 },
        recentQueries: [],
      },
      viewStatePath,
    );

    const after = readRaw();
    // XState fields preserved
    expect(after.status).toBe("active");
    expect(after.value).toEqual({ viewing: "workstream_dashboard" });
    expect(after.context).toEqual({ workstreamSlug: "crux", problemSlug: null });
    expect(after.historyValue).toEqual({});
    expect(after.children).toEqual({});
    // Sidecar fields written
    expect(after.revision).toBe(1);
    expect(after.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 1234567890 });
    expect(after.recentQueries).toEqual([]);
  });

  test("saveViewMeta then saveViewMeta increments cleanly without losing XState", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({
        status: "active",
        value: { viewing: "problem_detail" },
        context: { workstreamSlug: "crux", problemSlug: "foo" },
      }),
      "utf8",
    );

    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 1,
        lastAction: { kind: "ADD_SOLUTION", ts: 1 },
        recentQueries: [],
      },
      viewStatePath,
    );
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 2,
        lastAction: { kind: "SHIP_SOLUTION", ts: 2 },
        recentQueries: [{ kind: "PROBLEM_SHOW", slug: "foo", ts: 5 }],
      },
      viewStatePath,
    );

    const after = readRaw();
    expect(after.value).toEqual({ viewing: "problem_detail" });
    expect(after.context).toEqual({ workstreamSlug: "crux", problemSlug: "foo" });
    expect(after.revision).toBe(2);
    expect((after.lastAction as { kind: string }).kind).toBe("SHIP_SOLUTION");
    expect((after.recentQueries as unknown[])[0]).toMatchObject({ kind: "PROBLEM_SHOW" });
  });
});

describe("persistence merge: loadViewMeta returns merged shape", () => {
  test("loadViewMeta from a fully merged file returns both XState and sidecar fields", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({
        status: "active",
        value: { viewing: "problem_detail" },
        context: { workstreamSlug: "crux", problemSlug: "foo" },
        historyValue: {},
        children: {},
        revision: 7,
        lastAction: { kind: "ADD_DECISION", ts: 1700 },
        recentQueries: [{ kind: "CONTEXT_SHOW", slug: "crux", ts: 1500 }],
      }),
      "utf8",
    );

    const meta = loadViewMeta(viewStatePath);
    expect(meta.value).toEqual({ viewing: "problem_detail" });
    expect(meta.context).toEqual({ workstreamSlug: "crux", problemSlug: "foo" });
    expect(meta.revision).toBe(7);
    expect(meta.lastAction).toEqual({ kind: "ADD_DECISION", ts: 1700 });
    expect(meta.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "crux", ts: 1500 }]);
  });

  test("loadViewMeta from sidecar-only file (no XState fields) returns defaults for value/context", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({ revision: 3, lastAction: { kind: "X", ts: 1 }, recentQueries: [] }),
      "utf8",
    );
    const meta = loadViewMeta(viewStatePath);
    // Defaults for missing XState fields
    expect(meta.value).toEqual({ viewing: "workstream_list" });
    expect(meta.context).toEqual({ workstreamSlug: null, problemSlug: null });
    expect(meta.revision).toBe(3);
  });
});

describe("persistence merge: saveState preserves sidecar fields", () => {
  test("saveState over a file with sidecar fields preserves revision/lastAction/recentQueries", () => {
    // Hand-write a sidecar-only file (simulates state after a mutation but before XState write)
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({
        revision: 5,
        lastAction: { kind: "ADD_PROBLEM", ts: 1000 },
        recentQueries: [{ kind: "CONTEXT_SHOW", slug: "crux", ts: 999 }],
      }),
      "utf8",
    );

    // Drive XState to a snapshot and save it — this is what sendViewEvent does internally.
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    saveState(viewStatePath, snap);

    const after = readRaw();
    // XState fields written
    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
    expect(after.status).toBe("active");
    // Sidecar fields preserved
    expect(after.revision).toBe(5);
    expect(after.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 1000 });
    expect(after.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "crux", ts: 999 }]);
  });

  test("interleaved: saveState → saveViewMeta → saveState keeps all fields populated", () => {
    // Step 1: empty file, saveState writes XState fields
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    saveState(viewStatePath, snap);

    const afterStep1 = readRaw();
    expect(afterStep1.value).toBeDefined();
    expect(afterStep1.revision).toBe(0); // initialized to default
    expect(afterStep1.lastAction).toBeNull();

    // Step 2: saveViewMeta updates sidecar — XState fields must survive
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 1,
        lastAction: { kind: "ADD_WORKSTREAM", ts: 2000 },
        recentQueries: [],
      },
      viewStatePath,
    );
    const afterStep2 = readRaw();
    expect(afterStep2.value).toEqual(afterStep1.value);
    expect(afterStep2.context).toEqual(afterStep1.context);
    expect(afterStep2.revision).toBe(1);
    expect((afterStep2.lastAction as { kind: string }).kind).toBe("ADD_WORKSTREAM");

    // Step 3: another saveState — sidecar must survive again
    saveState(viewStatePath, snap);
    const afterStep3 = readRaw();
    expect(afterStep3.value).toBeDefined();
    expect(afterStep3.revision).toBe(1);
    expect((afterStep3.lastAction as { kind: string }).kind).toBe("ADD_WORKSTREAM");
  });
});

describe("saveState lastActionKind option: stamps lastAction + bumps revision", () => {
  function makeSnap() {
    const actor = createActor(viewMachine);
    actor.start();
    const s = actor.getSnapshot();
    actor.stop();
    return s;
  }

  test("saveState with lastActionKind on empty file → revision=1, lastAction.kind set", () => {
    const snap = makeSnap();
    saveState(viewStatePath, snap, { lastActionKind: "SELECT_WORKSTREAM" });
    const after = readRaw();
    expect(after.revision).toBe(1);
    expect((after.lastAction as { kind: string }).kind).toBe("SELECT_WORKSTREAM");
    expect(typeof (after.lastAction as { ts: number }).ts).toBe("number");
  });

  test("ViewEvent then Mutation: file has lastAction.kind = mutation kind (mutation overwrites)", () => {
    const snap = makeSnap();
    // Step 1: simulate sendViewEvent
    saveState(viewStatePath, snap, { lastActionKind: "SELECT_WORKSTREAM" });
    expect((readRaw().lastAction as { kind: string }).kind).toBe("SELECT_WORKSTREAM");
    expect(readRaw().revision).toBe(1);

    // Step 2: simulate recordMutation via saveViewMeta
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 2,
        lastAction: { kind: "ADD_SOLUTION", ts: 5000 },
        recentQueries: [],
      },
      viewStatePath,
    );

    const after = readRaw();
    expect(after.revision).toBe(2);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_SOLUTION");
    // XState fields still present
    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
  });

  test("Mutation then ViewEvent: file has lastAction.kind = view event type (view overwrites)", () => {
    const snap = makeSnap();
    // Initialize with XState fields first
    saveState(viewStatePath, snap);

    // Step 1: simulate recordMutation
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 1,
        lastAction: { kind: "ADD_SOLUTION", ts: 1000 },
        recentQueries: [],
      },
      viewStatePath,
    );
    expect((readRaw().lastAction as { kind: string }).kind).toBe("ADD_SOLUTION");
    expect(readRaw().revision).toBe(1);

    // Step 2: simulate sendViewEvent BACK
    saveState(viewStatePath, snap, { lastActionKind: "BACK" });

    const after = readRaw();
    expect((after.lastAction as { kind: string }).kind).toBe("BACK");
    // revision bumped from existing 1 → 2
    expect(after.revision).toBe(2);
    // recentQueries preserved
    expect(after.recentQueries).toEqual([]);
  });

  test("saveState without lastActionKind preserves existing lastAction (no overwrite)", () => {
    const snap = makeSnap();
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamSlug: null, problemSlug: null },
        revision: 7,
        lastAction: { kind: "ADD_PROBLEM", ts: 99 },
        recentQueries: [],
      },
      viewStatePath,
    );
    // Plain saveState (no opts) — must not stamp anything
    saveState(viewStatePath, snap);
    const after = readRaw();
    expect(after.revision).toBe(7);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_PROBLEM");
  });
});
