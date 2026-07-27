/**
 * Slice 1 — the ViewStore seam. dispatch() must persist view-state through an
 * injected store, never the filesystem. These tests drive that seam with an
 * in-memory store: if any fs call remained on the dispatch path, the memory
 * store would be bypassed and the assertions below would not hold.
 */
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryViewStore } from "../store.js";
import { loadViewMetaFromBlob, computeSaveViewMetaBlob, type ViewMeta } from "../persistence.js";
import { dispatch } from "../../actions/dispatch.js";
import type { CruxDb } from "../../db/client.js";

/** A CruxDb double: only the `select…from…where…limit` guard chain is exercised. */
function dbReturning(rows: unknown[]): CruxDb {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => rows,
  };
  return { select: () => chain } as unknown as CruxDb;
}

describe("MemoryViewStore", () => {
  test("starts empty and round-trips a blob", async () => {
    const store = new MemoryViewStore();
    expect(await store.read()).toEqual({});
    await store.write({ revision: 3, hello: "world" });
    expect(await store.read()).toEqual({ revision: 3, hello: "world" });
  });

  test("seeds from an initial blob", async () => {
    const store = new MemoryViewStore({ revision: 7 });
    expect(await store.read()).toEqual({ revision: 7 });
  });
});

describe("pure ViewMeta blob helpers (no fs)", () => {
  test("loadViewMetaFromBlob defaults an empty blob", () => {
    const meta = loadViewMetaFromBlob({});
    expect(meta.revision).toBe(0);
    expect(meta.lastAction).toBeNull();
    expect(meta.recentQueries).toEqual([]);
    expect(meta.value).toEqual({ viewing: "workstream_list" });
  });

  test("loadViewMetaFromBlob reads an existing revision and value", () => {
    const meta = loadViewMetaFromBlob({
      revision: 5,
      value: { viewing: "workstream_dashboard" },
      context: { workstreamId: "WS-crux", problemId: null },
      lastAction: { kind: "SELECT_WORKSTREAM", ts: 111 },
    });
    expect(meta.revision).toBe(5);
    expect(meta.value).toEqual({ viewing: "workstream_dashboard" });
    expect(meta.context.workstreamId).toBe("WS-crux");
  });

  test("computeSaveViewMetaBlob merges sidecar over existing xstate fields", () => {
    const existing = { value: { viewing: "workstream_list" }, status: "active", revision: 1 };
    const meta: ViewMeta = {
      value: { viewing: "workstream_list" },
      context: { workstreamId: null, problemId: null },
      revision: 2,
      lastAction: { kind: "ADD_PROBLEM", ts: 999 },
      recentQueries: [],
    };
    const merged = computeSaveViewMetaBlob(existing, meta);
    expect(merged.revision).toBe(2);
    expect(merged.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 999 });
    // xstate fields survive the merge
    expect(merged.value).toEqual({ viewing: "workstream_list" });
    expect(merged.status).toBe("active");
  });
});

describe("dispatch() through an injected ViewStore touches no filesystem", () => {
  test("a view action persists to the store and never writes view-state.json", async () => {
    // Point the fs fallback at a path that must NOT be created.
    const sentinel = join(tmpdir(), `crux-viewstate-should-not-exist-${process.pid}.json`);
    const prev = process.env.CRUX_VIEW_STATE_PATH;
    process.env.CRUX_VIEW_STATE_PATH = sentinel;
    try {
      const store = new MemoryViewStore();
      const db = dbReturning([{ id: "WS-crux" }]);

      const result = await dispatch(
        { kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } },
        { db, viewStore: store },
      );

      expect(result.revision).toBe(1);
      const blob = await store.read();
      expect(blob.revision).toBe(1);
      // XState advanced into the dashboard and recorded the selected workstream.
      expect(JSON.stringify(blob.value)).toContain("workstream_dashboard");
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.CRUX_VIEW_STATE_PATH;
      else process.env.CRUX_VIEW_STATE_PATH = prev;
    }
  });
});
