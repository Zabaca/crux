/**
 * The ViewStore seam. dispatch() persists view-state through an injected store
 * and there is no filesystem-backed store to fall back to — omitting one is a
 * compile error, which is what keeps `node:fs` out of the Worker bundle.
 */
import { describe, test, expect } from "bun:test";
import { MemoryViewStore } from "../store.js";
import { loadViewMetaFromBlob, computeSaveViewMetaBlob, type ViewMeta } from "../persistence.js";
import { dispatch } from "../../actions/dispatch.js";
import type { CruxDb } from "../../db/client.js";

/**
 * A CruxDb double: a `select().from().where()` chain that answers `rows`.
 *
 * `where()` answers a real Promise carrying a `limit()`, the way drizzle's
 * builder does, because a scoped read may end at either: a lookup that takes
 * one row, or `resolveScope`, which joins across `users` and `workstreams` and
 * awaits the builder directly.
 */
function dbReturning(rows: unknown[]): CruxDb {
  const answer = () => Object.assign(Promise.resolve(rows), { limit: async () => rows });
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: answer,
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
      lastAction: { kind: "SELECT_WORKSTREAM", ts: 111, workstreamId: null },
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
      lastAction: { kind: "ADD_PROBLEM", ts: 999, workstreamId: null },
      recentQueries: [],
    };
    const merged = computeSaveViewMetaBlob(existing, meta);
    expect(merged.revision).toBe(2);
    expect(merged.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 999, workstreamId: null });
    // xstate fields survive the merge
    expect(merged.value).toEqual({ viewing: "workstream_list" });
    expect(merged.status).toBe("active");
  });
});

describe("dispatch() persists through the injected ViewStore", () => {
  test("a view action lands in the store", async () => {
    const store = new MemoryViewStore();
    const db = dbReturning([{ id: "WS-crux" }]);

    const result = await dispatch(
      { kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } },
      {
        db,
        viewStore: store,
        actor: { id: "USR-test" },
        // Unreachable on this path — a view action is not a corpus write — but
        // dispatch() demands one rather than choosing an allowance by omission.
        capacity: { observationCap: 200, claimUrl: "https://crux.example/claim" },
      },
    );

    expect(result.revision).toBe(1);
    const blob = await store.read();
    expect(blob.revision).toBe(1);
    // XState advanced into the dashboard and recorded the selected workstream.
    expect(JSON.stringify(blob.value)).toContain("workstream_dashboard");
  });

  test("omitting the store is a compile error, not a runtime fallback", () => {
    // Asserted by `bun run typecheck`: if `viewStore` (or `actor`) ever becomes
    // optional again, these lines stop erroring and @ts-expect-error fails the
    // build. There is nothing to assert at runtime — that is the whole point.
    const db = dbReturning([]);
    const call = () =>
      // @ts-expect-error viewStore and actor are required on dispatch()
      dispatch({ kind: "SELECT_WORKSTREAM", payload: { id: "WS-crux" } }, { db });
    expect(typeof call).toBe("function");
  });
});
