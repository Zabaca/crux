import { describe, expect, test } from "bun:test";
import { snapshotToView } from "../useViewState.js";

describe("snapshotToView", () => {
  test("initial state maps to workstream_list", () => {
    const snap = {
      value: { viewing: "workstream_list" } as unknown,
      context: { workstreamId: null, problemId: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({ kind: "workstream_list" });
  });

  test("dashboard with id maps to workstream_dashboard", () => {
    const snap = {
      value: { viewing: "workstream_dashboard" },
      context: { workstreamId: "WS-crux", problemId: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({
      kind: "workstream_dashboard",
      workstreamId: "WS-crux",
    });
  });

  test("problem_detail with both ids", () => {
    const snap = {
      value: { viewing: "problem_detail" },
      context: { workstreamId: "WS-crux", problemId: "42" },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({
      kind: "problem_detail",
      workstreamId: "WS-crux",
      problemId: 42,
    });
  });

  test("dashboard without id falls back to list", () => {
    const snap = {
      value: { viewing: "workstream_dashboard" },
      context: { workstreamId: null, problemId: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({ kind: "workstream_list" });
  });
});
