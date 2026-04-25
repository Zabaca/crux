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
        context: { workstreamSlug: null, problemSlug: null },
      }),
    ).toBe("/");
  });

  test("workstream_dashboard → /w/<slug>", () => {
    expect(
      stateToPath({
        value: { viewing: "workstream_dashboard" },
        context: { workstreamSlug: "crux", problemSlug: null },
      }),
    ).toBe("/w/crux");
  });

  test("problem_detail → /w/<slug>/problems/<problem>", () => {
    expect(
      stateToPath({
        value: { viewing: "problem_detail" },
        context: { workstreamSlug: "crux", problemSlug: "thinking-residue-gap" },
      }),
    ).toBe("/w/crux/problems/thinking-residue-gap");
  });

  test("falls back to / when context is missing", () => {
    expect(
      stateToPath({
        value: { viewing: "workstream_dashboard" },
        context: { workstreamSlug: null, problemSlug: null },
      }),
    ).toBe("/");
  });
});

describe("view-state listener", () => {
  test("mounts without crashing and renders nothing visible", () => {
    // Provide a stub EventSource for happy-dom.
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
