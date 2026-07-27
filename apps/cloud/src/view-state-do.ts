/**
 * ViewStateDO — per-user view-state, off the filesystem (the reason this ticket
 * is ordered ahead of the UI). One Durable Object instance per user (addressed
 * by `idFromName(userId)`) owns that user's view-state blob and a push stream
 * that later live-refresh surfaces subscribe to.
 *
 * The object speaks a tiny internal HTTP protocol so the Worker can wrap it as a
 * `ViewStore` (see `DurableObjectViewStore`): `GET /read`, `PUT /write`,
 * `GET /stream` (Server-Sent Events).
 */
import type { ViewBlob, ViewStore } from "@crux/core/view-state";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Minimal storage surface used here — satisfied by `DurableObjectStorage`. */
interface KvStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
interface DOStateLike {
  storage: KvStorage;
}

export class ViewStateDO {
  private readonly storage: KvStorage;
  private readonly streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

  constructor(state: DOStateLike) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/read") {
      return json((await this.storage.get<ViewBlob>("blob")) ?? {});
    }

    if (request.method === "PUT" && pathname === "/write") {
      const blob = (await request.json()) as ViewBlob;
      await this.storage.put("blob", blob);
      this.broadcast(blob);
      return json({ ok: true });
    }

    if (request.method === "GET" && pathname === "/stream") {
      return this.streamResponse();
    }

    return json({ error: "not_found" }, 404);
  }

  /** Push the new revision to every open SSE subscriber. */
  private broadcast(blob: ViewBlob): void {
    const revision = typeof blob.revision === "number" ? blob.revision : 0;
    const bytes = new TextEncoder().encode(
      `event: view\ndata: ${JSON.stringify({ revision })}\n\n`,
    );
    for (const controller of this.streams) {
      try {
        controller.enqueue(bytes);
      } catch {
        this.streams.delete(controller);
      }
    }
  }

  private streamResponse(): Response {
    const streams = this.streams;
    let self: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        streams.add(controller);
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
      },
      cancel() {
        if (self) streams.delete(self);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }
}

/** The subset of a Durable Object stub the store adapter needs. */
export interface ViewStoreStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/**
 * Wraps a ViewStateDO stub as a `ViewStore`, so `dispatch()` reads and writes
 * view-state from the Durable Object exactly as it would from a file locally.
 */
export class DurableObjectViewStore implements ViewStore {
  constructor(private readonly stub: ViewStoreStub) {}

  async read(): Promise<ViewBlob> {
    const res = await this.stub.fetch("https://view-state/read");
    return (await res.json()) as ViewBlob;
  }

  async write(blob: ViewBlob): Promise<void> {
    await this.stub.fetch("https://view-state/write", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(blob),
    });
  }
}
