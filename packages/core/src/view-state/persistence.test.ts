/**
 * Persistence merge tests — both write paths must preserve the other's fields.
 *
 * The blob these merge over used to be a file; it is now whatever the caller's
 * ViewStore hands back, so the merges are exercised directly on blobs.
 */
import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import {
  computeSaveStateBlob,
  computeSaveViewMetaBlob,
  loadViewMetaFromBlob,
} from "./persistence.js";
import type { ViewBlob } from "./store.js";
import { viewMachine } from "./machine.js";

function makeSnap() {
  const actor = createActor(viewMachine);
  actor.start();
  const s = actor.getSnapshot();
  actor.stop();
  return s;
}

describe("persistence merge: computeSaveViewMetaBlob preserves XState fields", () => {
  test("sidecar merge over a blob with XState fields preserves value/context/status", () => {
    const existing: ViewBlob = {
      status: "active",
      value: { viewing: "workstream_dashboard" },
      context: { workstreamId: "WS-crux", problemId: null },
      historyValue: {},
      children: {},
    };

    const after = computeSaveViewMetaBlob(existing, {
      value: { viewing: "workstream_list" },
      context: { workstreamId: null, problemId: null },
      revision: 1,
      lastAction: { kind: "ADD_PROBLEM", ts: 1234567890, workstreamId: null },
      recentQueries: [],
    });

    expect(after.status).toBe("active");
    expect(after.value).toEqual({ viewing: "workstream_dashboard" });
    expect(after.context).toEqual({ workstreamId: "WS-crux", problemId: null });
    expect(after.historyValue).toEqual({});
    expect(after.children).toEqual({});
    expect(after.revision).toBe(1);
    expect(after.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 1234567890, workstreamId: null });
    expect(after.recentQueries).toEqual([]);
  });

  test("two sidecar merges in a row increment cleanly without losing XState", () => {
    let blob: ViewBlob = {
      status: "active",
      value: { viewing: "problem_detail" },
      context: { workstreamId: "WS-crux", problemId: "42" },
    };

    blob = computeSaveViewMetaBlob(blob, {
      value: {} as unknown,
      context: { workstreamId: null, problemId: null },
      revision: 1,
      lastAction: { kind: "ADD_ATTEMPT", ts: 1, workstreamId: null },
      recentQueries: [],
    });
    blob = computeSaveViewMetaBlob(blob, {
      value: {} as unknown,
      context: { workstreamId: null, problemId: null },
      revision: 2,
      lastAction: { kind: "CLOSE_ATTEMPT", ts: 2, workstreamId: null },
      recentQueries: [{ kind: "PROBLEM_SHOW", slug: "42", ts: 5 }],
    });

    expect(blob.value).toEqual({ viewing: "problem_detail" });
    expect(blob.context).toEqual({ workstreamId: "WS-crux", problemId: "42" });
    expect(blob.revision).toBe(2);
    expect((blob.lastAction as { kind: string }).kind).toBe("CLOSE_ATTEMPT");
    expect((blob.recentQueries as unknown[])[0]).toMatchObject({ kind: "PROBLEM_SHOW" });
  });
});

describe("persistence merge: loadViewMetaFromBlob returns merged shape", () => {
  test("a fully merged blob yields both XState and sidecar fields", () => {
    const meta = loadViewMetaFromBlob({
      status: "active",
      value: { viewing: "problem_detail" },
      context: { workstreamId: "WS-crux", problemId: "42" },
      historyValue: {},
      children: {},
      revision: 7,
      lastAction: { kind: "ADD_ATTEMPT", ts: 1700, workstreamId: null },
      recentQueries: [{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 1500 }],
    });

    expect(meta.value).toEqual({ viewing: "problem_detail" });
    expect(meta.context).toEqual({ workstreamId: "WS-crux", problemId: "42" });
    expect(meta.revision).toBe(7);
    expect(meta.lastAction).toEqual({ kind: "ADD_ATTEMPT", ts: 1700, workstreamId: null });
    expect(meta.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 1500 }]);
  });

  test("a sidecar-only blob (no XState fields) returns defaults for value/context", () => {
    const meta = loadViewMetaFromBlob({
      revision: 3,
      lastAction: { kind: "X", ts: 1, workstreamId: null },
      recentQueries: [],
    });
    expect(meta.value).toEqual({ viewing: "workstream_list" });
    expect(meta.context).toEqual({ workstreamId: null, problemId: null });
    expect(meta.revision).toBe(3);
  });
});

describe("persistence merge: computeSaveStateBlob preserves sidecar fields", () => {
  test("an XState write over a blob with sidecar fields preserves revision/lastAction/recentQueries", () => {
    const after = computeSaveStateBlob(
      {
        revision: 5,
        lastAction: { kind: "ADD_PROBLEM", ts: 1000, workstreamId: null },
        recentQueries: [{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 999 }],
      },
      makeSnap(),
    );

    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
    expect(after.status).toBe("active");
    expect(after.revision).toBe(5);
    expect(after.lastAction).toEqual({ kind: "ADD_PROBLEM", ts: 1000, workstreamId: null });
    expect(after.recentQueries).toEqual([{ kind: "CONTEXT_SHOW", slug: "WS-crux", ts: 999 }]);
  });

  test("interleaved: state → sidecar → state keeps all fields populated", () => {
    const snap = makeSnap();
    const afterStep1 = computeSaveStateBlob({}, snap);
    expect(afterStep1.value).toBeDefined();
    expect(afterStep1.revision).toBe(0);
    expect(afterStep1.lastAction).toBeNull();

    const afterStep2 = computeSaveViewMetaBlob(afterStep1, {
      value: {} as unknown,
      context: { workstreamId: null, problemId: null },
      revision: 1,
      lastAction: { kind: "ADD_WORKSTREAM", ts: 2000, workstreamId: null },
      recentQueries: [],
    });
    expect(afterStep2.value).toEqual(afterStep1.value);
    expect(afterStep2.context).toEqual(afterStep1.context);
    expect(afterStep2.revision).toBe(1);
    expect((afterStep2.lastAction as { kind: string }).kind).toBe("ADD_WORKSTREAM");

    const afterStep3 = computeSaveStateBlob(afterStep2, snap);
    expect(afterStep3.value).toBeDefined();
    expect(afterStep3.revision).toBe(1);
    expect((afterStep3.lastAction as { kind: string }).kind).toBe("ADD_WORKSTREAM");
  });
});

describe("computeSaveStateBlob lastActionKind option: stamps lastAction + bumps revision", () => {
  test("with lastActionKind over an empty blob → revision=1, lastAction.kind set", () => {
    const after = computeSaveStateBlob({}, makeSnap(), { lastActionKind: "SELECT_WORKSTREAM" });
    expect(after.revision).toBe(1);
    expect((after.lastAction as { kind: string }).kind).toBe("SELECT_WORKSTREAM");
    expect(typeof (after.lastAction as { ts: number }).ts).toBe("number");
  });

  test("ViewEvent then Mutation: lastAction.kind is the mutation kind (mutation overwrites)", () => {
    const snap = makeSnap();
    const afterView = computeSaveStateBlob({}, snap, { lastActionKind: "SELECT_WORKSTREAM" });
    expect((afterView.lastAction as { kind: string }).kind).toBe("SELECT_WORKSTREAM");
    expect(afterView.revision).toBe(1);

    const after = computeSaveViewMetaBlob(afterView, {
      value: {} as unknown,
      context: { workstreamId: null, problemId: null },
      revision: 2,
      lastAction: { kind: "ADD_ATTEMPT", ts: 5000, workstreamId: null },
      recentQueries: [],
    });

    expect(after.revision).toBe(2);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_ATTEMPT");
    expect(after.value).toBeDefined();
    expect(after.context).toBeDefined();
  });

  test("Mutation then ViewEvent: lastAction.kind is the view event type (view overwrites)", () => {
    const snap = makeSnap();
    const afterMutation = computeSaveViewMetaBlob(computeSaveStateBlob({}, snap), {
      value: {} as unknown,
      context: { workstreamId: null, problemId: null },
      revision: 1,
      lastAction: { kind: "ADD_ATTEMPT", ts: 1000, workstreamId: null },
      recentQueries: [],
    });
    expect((afterMutation.lastAction as { kind: string }).kind).toBe("ADD_ATTEMPT");
    expect(afterMutation.revision).toBe(1);

    const after = computeSaveStateBlob(afterMutation, snap, { lastActionKind: "BACK" });
    expect((after.lastAction as { kind: string }).kind).toBe("BACK");
    expect(after.revision).toBe(2);
    expect(after.recentQueries).toEqual([]);
  });

  test("without lastActionKind, an existing lastAction is preserved (no overwrite)", () => {
    const snap = makeSnap();
    const existing = computeSaveViewMetaBlob(
      {},
      {
        value: {} as unknown,
        context: { workstreamId: null, problemId: null },
        revision: 7,
        lastAction: { kind: "ADD_PROBLEM", ts: 99, workstreamId: null },
        recentQueries: [],
      },
    );
    const after = computeSaveStateBlob(existing, snap);
    expect(after.revision).toBe(7);
    expect((after.lastAction as { kind: string }).kind).toBe("ADD_PROBLEM");
  });
});

describe("lastAction names the Workstream the action touched", () => {
  test("computeSaveStateBlob stamps the Workstream it is given", () => {
    const after = computeSaveStateBlob({}, makeSnap(), {
      lastActionKind: "SELECT_WORKSTREAM",
      lastActionWorkstreamId: "WS-crux",
    });
    expect(after.lastAction).toMatchObject({
      kind: "SELECT_WORKSTREAM",
      workstreamId: "WS-crux",
    });
  });

  test("without one, the stamp says null rather than omitting the field", () => {
    const after = computeSaveStateBlob({}, makeSnap(), { lastActionKind: "BACK" });
    expect((after.lastAction as { workstreamId: string | null }).workstreamId).toBeNull();
  });

  test("a blob written before the field existed loads with workstreamId null", () => {
    const meta = loadViewMetaFromBlob({
      revision: 4,
      lastAction: { kind: "ADD_ATTEMPT", ts: 1700 },
      recentQueries: [],
    });
    expect(meta.lastAction).toEqual({ kind: "ADD_ATTEMPT", ts: 1700, workstreamId: null });
  });

  test("a corrupt lastAction reads as absent rather than throwing", () => {
    expect(loadViewMetaFromBlob({ revision: 1, lastAction: "nonsense" }).lastAction).toBeNull();
  });
});
