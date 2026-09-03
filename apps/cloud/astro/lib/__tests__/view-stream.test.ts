/**
 * The push stream's subscriber side: a page showing one Workstream hears only
 * about that one.
 *
 * `EventSource` is stubbed rather than mocked out of a browser: the only part
 * under test is which frames reach the callback, and that is decided here.
 */
import { describe, expect, test } from "bun:test";
import { onViewStateChange, type ViewStateChange } from "../dispatch.js";

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static last: FakeEventSource | null = null;
  closed = false;
  private listeners: Listener[] = [];
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: Listener): void {
    if (type === "view") this.listeners.push(listener);
  }
  close(): void {
    this.closed = true;
  }
  push(data: string): void {
    for (const l of this.listeners) l({ data });
  }
}

function subscribe(opts: { workstreamId?: string } = {}) {
  const original = (globalThis as { EventSource?: unknown }).EventSource;
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  const heard: ViewStateChange[] = [];
  const stop = onViewStateChange((change) => heard.push(change), opts);
  (globalThis as { EventSource?: unknown }).EventSource = original;
  return { heard, stop, source: FakeEventSource.last! };
}

describe("onViewStateChange", () => {
  test("an unfiltered subscriber hears every frame", () => {
    const { heard, source } = subscribe();
    source.push(JSON.stringify({ revision: 1, workstreamId: "WS-crux" }));
    source.push(JSON.stringify({ revision: 2, workstreamId: "WS-farm" }));
    expect(heard).toEqual([
      { revision: 1, workstreamId: "WS-crux" },
      { revision: 2, workstreamId: "WS-farm" },
    ]);
  });

  test("a subscriber showing one Workstream ignores frames from another", () => {
    const { heard, source } = subscribe({ workstreamId: "WS-crux" });
    source.push(JSON.stringify({ revision: 1, workstreamId: "WS-farm" }));
    expect(heard).toEqual([]);
    source.push(JSON.stringify({ revision: 2, workstreamId: "WS-crux" }));
    expect(heard).toEqual([{ revision: 2, workstreamId: "WS-crux" }]);
  });

  test("a Workstream-less frame reaches an unfiltered subscriber and not a filtered one", () => {
    const open = subscribe();
    const scoped = subscribe({ workstreamId: "WS-crux" });
    const frame = JSON.stringify({ revision: 3, workstreamId: null });
    open.source.push(frame);
    scoped.source.push(frame);
    expect(open.heard).toEqual([{ revision: 3, workstreamId: null }]);
    expect(scoped.heard).toEqual([]);
  });

  test("a frame from a deployment without the field still parses", () => {
    const { heard, source } = subscribe();
    source.push(JSON.stringify({ revision: 9 }));
    expect(heard).toEqual([{ revision: 9, workstreamId: null }]);
  });

  test("an unparseable frame is dropped, not thrown", () => {
    const { heard, source } = subscribe();
    expect(() => source.push("not json")).not.toThrow();
    expect(heard).toEqual([]);
  });

  test("the returned unsubscribe closes the stream", () => {
    const { stop, source } = subscribe();
    stop();
    expect(source.closed).toBe(true);
  });
});
