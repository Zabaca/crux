import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { RecentQueriesPanel } from "../components/recent-queries-panel.js";

// Stub EventSource globally before imports that use it.
type MockEventSourceInstance = {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
  _trigger: (data: unknown) => void;
};

function makeMockEventSource(): MockEventSourceInstance {
  return {
    onmessage: null,
    onerror: null,
    close() {},
    _trigger(data: unknown) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(data) } as { data: string });
      }
    },
  };
}

describe("RecentQueriesPanel", () => {
  test("renders nothing when no queries", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = class {
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
    };
    const { container } = render(<RecentQueriesPanel />);
    expect(container.textContent).toBe("");
  });

  test("renders null (no output) when queries list is empty on init", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).EventSource = class {
      onerror: (() => void) | null = null;
      close() {}
      // onmessage intentionally not set — simulates no-message scenario
    };

    const { container } = render(<RecentQueriesPanel />);
    expect(container.textContent).toBe("");
    void screen; // suppress unused import warning
  });
});
