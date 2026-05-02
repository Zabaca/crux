/**
 * Persistence merge tests — both write paths must preserve the other's fields.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createActor } from "xstate";
import { loadViewMeta, saveState, saveViewMeta } from "./persistence.js";
import { viewMachine } from "./machine.js";

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
    const xstateJson = {
      status: "active",
      value: { viewing: "workstream_dashboard" },
      context: { workstreamId: "WS-crux", problemId: null },
      historyValue: {},
      children: {},
    };
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(viewStatePath, JSON.stringify(xstateJson, null, 2), "utf8");

    saveViewMeta(
      {
        value: { viewing: "workstream_list" },
        context: { workstreamId: null, problemId: null },
        revision: 1,
        lastAction: { kind: "ADD_PROBLEM", ts: 1234567890 },
        recentQueries: [],
      },
      viewStatePath,
    );

    const after = readRaw();
    expect(after.status).toBe("active");
    expect(after.value).toEqual({ viewing: "workstream_dashboard" });
    expect(after.context).toEqual({ workstreamId: "WS-crux", problemId: null });
    expect(after.historyValue).toEqual({});
    expect(after.children).toEqual({});
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
        context: { workstreamId: "WS-crux", problemId: "42" },
      }),
      "utf8",
    );

    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 1,
        lastAction: { kind: "ADD_SOLUTION", ts: 1 },
        recentQueries: [],
      },
      viewStatePath,
    );
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 2,
        lastAction: { kind: "SHIP_SOLUTION", ts: 2 },
        recentQueries: [{ kind: "PROBLEM_SHOW", slug: "42", ts: 5 }],
      },
      viewStatePath,
    );

    const after = readRaw();
    expect(after.value).toEqual({ viewing: "problem_detail" });
    expect(after.context).toEqual({ workstreamId: "WS-crux", problemId: "42" });
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
        context: { workstreamId: "WS-crux", problemId: "42" },
        historyValue: {},
        children: {},
        revision: 7,
        lastAction: { kind: "ADD_DECISION", ts: 1700 },
        recentQueries: [{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 1500 }],
      }),
      "utf8",
    );

    const meta = loadViewMeta(viewStatePath);
    expect(meta.value).toEqual({ viewing: "problem_detail" });
    expect(meta.context).toEqual({ workstreamId: "WS-crux", problemId: "42" });
    expect(meta.revision).toBe(7);
    expect(meta.lastAction).toEqual({ kind: "ADD_DECISION", ts: 1700 });
    expect(meta.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 1500 }]);
  });

  test("loadViewMeta from sidecar-only file (no XState fields) returns defaults for value/context", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({ revision: 3, lastAction: { kind: "X", ts: 1 }, recentQueries: [] }),
      "utf8",
    );
    const meta = loadViewMeta(viewStatePath);
    expect(meta.value).toEqual({ viewing: "workstream_list" });
    expect(meta.context).toEqual({ workstreamId: null, problemId: null });
    expect(meta.revision).toBe(3);
  });
});

describe("persistence merge: saveState preserves sidecar fields", () => {
  test("saveState over a file with sidecar fields preserves revision/lastAction/recentQueries", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(
      viewStatePath,
      JSON.stringify({
        revision: 5,
        lastAction: { kind: "ADD_PROBLEM", ts: 1000 },
        recentQueries: [{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 999 }],
      }),
      "utf8",
    );

    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    saveState(viewStatePath, snap);

    const after = readRaw();
    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
    expect(after.status).toBe("active");
    expect(after.revision).toBe(5);
    expect(after.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 1000 });
    expect(after.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 999 }]);
  });

  test("interleaved: saveState → saveViewMeta → saveState keeps all fields populated", () => {
    const actor = createActor(viewMachine);
    actor.start();
    const snap = actor.getSnapshot();
    actor.stop();
    saveState(viewStatePath, snap);

    const afterStep1 = readRaw();
    expect(afterStep1.value).toBeDefined();
    expect(afterStep1.revision).toBe(0);
    expect(afterStep1.lastAction).toBeNull();

    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
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
    saveState(viewStatePath, snap, { lastActionKind: "SELECT_WORKSTREAM" });
    expect((readRaw().lastAction as { kind: string }).kind).toBe("SELECT_WORKSTREAM");
    expect(readRaw().revision).toBe(1);

    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 2,
        lastAction: { kind: "ADD_SOLUTION", ts: 5000 },
        recentQueries: [],
      },
      viewStatePath,
    );

    const after = readRaw();
    expect(after.revision).toBe(2);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_SOLUTION");
    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
  });

  test("Mutation then ViewEvent: file has lastAction.kind = view event type (view overwrites)", () => {
    const snap = makeSnap();
    saveState(viewStatePath, snap);

    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 1,
        lastAction: { kind: "ADD_SOLUTION", ts: 1000 },
        recentQueries: [],
      },
      viewStatePath,
    );
    expect((readRaw().lastAction as { kind: string }).kind).toBe("ADD_SOLUTION");
    expect(readRaw().revision).toBe(1);

    saveState(viewStatePath, snap, { lastActionKind: "BACK" });

    const after = readRaw();
    expect((after.lastAction as { kind: string }).kind).toBe("BACK");
    expect(after.revision).toBe(2);
    expect(after.recentQueries).toEqual([]);
  });

  test("saveState without lastActionKind preserves existing lastAction (no overwrite)", () => {
    const snap = makeSnap();
    saveViewMeta(
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 7,
        lastAction: { kind: "ADD_PROBLEM", ts: 99 },
        recentQueries: [],
      },
      viewStatePath,
    );
    saveState(viewStatePath, snap);
    const after = readRaw();
    expect(after.revision).toBe(7);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_PROBLEM");
  });
});
