import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { stateToPath } from "../lib/state-to-path.js";
import { ViewStateListener } from "../components/view-state-listener.js";

// Mock next/navigation before importing the component that uses it.
import { mock } from "bun:test";
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/",
}));

describe("state-to-path", () => {
  test("workstream_list → /", () => {
    expect(
      stateToPath({
        value: { viewing: "workstream_list" },
        context: { workstreamId: null, problemId: null },
      }),
    ).toBe("/");
  });

  test("workstream_dashboard → /w/WS-crux", () => {
    expect(
      stateToPath({
        value: { viewing: "workstream_dashboard" },
        context: { workstreamId: "WS-crux", problemId: null },
      }),
    ).toBe("/w/WS-crux");
  });

  test("problem_detail → /w/WS-crux/problems/42", () => {
    expect(
      stateToPath({
        value: { viewing: "problem_detail" },
        context: { workstreamId: "WS-crux", problemId: "42" },
      }),
    ).toBe("/w/WS-crux/problems/42");
  });

  test("falls back to / when context is missing", () => {
    expect(
      stateToPath({
        value: { viewing: "workstream_dashboard" },
        context: { workstreamId: null, problemId: null },
      }),
    ).toBe("/");
  });
});

describe("view-state listener", () => {
  test("mounts without crashing and renders nothing visible", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
    };
    const { container } = render(<ViewStateListener />);
    expect(container.textContent).toBe("");
  });
});
