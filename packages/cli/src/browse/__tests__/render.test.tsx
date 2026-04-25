import { describe, expect, test } from "bun:test";
import { snapshotToView } from "../useViewState.js";

// These are unit tests for the machine → TUI view mapper. They run fast and
// don't need a seeded db. Fuller integration (rendering ink screens against
// real db rows) is covered by the manual verification flow.

describe("snapshotToView", () => {
  test("initial state maps to workstream_list", () => {
    const snap = {
      value: { viewing: "workstream_list" } as unknown,
      context: { workstreamSlug: null, problemSlug: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({ kind: "workstream_list" });
  });

  test("dashboard with slug maps to workstream_dashboard", () => {
    const snap = {
      value: { viewing: "workstream_dashboard" },
      context: { workstreamSlug: "crux", problemSlug: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({
      kind: "workstream_dashboard",
      workstreamSlug: "crux",
    });
  });

  test("problem_detail with both slugs", () => {
    const snap = {
      value: { viewing: "problem_detail" },
      context: { workstreamSlug: "crux", problemSlug: "foo" },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({
      kind: "problem_detail",
      workstreamSlug: "crux",
      problemSlug: "foo",
    });
  });

  test("dashboard without slug falls back to list", () => {
    const snap = {
      value: { viewing: "workstream_dashboard" },
      context: { workstreamSlug: null, problemSlug: null },
    } as unknown as Parameters<typeof snapshotToView>[0];
    expect(snapshotToView(snap)).toEqual({ kind: "workstream_list" });
  });
});
