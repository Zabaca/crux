/**
 * ViewStore — where a user's view-state blob lives.
 *
 * dispatch() reads and writes view-state exclusively through this interface, and
 * a store is required rather than defaulted, so no storage medium is wired in by
 * omission. The cloud Worker keeps view-state in a per-user Durable Object
 * (`DurableObjectViewStore`, in apps/cloud); there is deliberately no
 * filesystem-backed store here — one would put `node:fs` in the Worker bundle.
 *
 * The blob is the whole view-state record: the XState persisted snapshot
 * fields (`value`, `context`, `status`, …) plus the sidecar fields (`revision`,
 * `lastAction`, `recentQueries`). Stores treat it as opaque JSON.
 */
export type ViewBlob = Record<string, unknown>;

export interface ViewStore {
  /** Read the whole blob. Missing/corrupt storage returns `{}`. */
  read(): Promise<ViewBlob>;
  /** Overwrite the whole blob. */
  write(blob: ViewBlob): Promise<void>;
}

/** In-memory store — for tests and any caller with nowhere durable to put it. */
export class MemoryViewStore implements ViewStore {
  private blob: ViewBlob;
  constructor(initial: ViewBlob = {}) {
    this.blob = initial;
  }
  async read(): Promise<ViewBlob> {
    return this.blob;
  }
  async write(blob: ViewBlob): Promise<void> {
    this.blob = blob;
  }
}
