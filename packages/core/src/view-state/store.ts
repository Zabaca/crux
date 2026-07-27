/**
 * ViewStore — where a user's view-state blob lives.
 *
 * dispatch() reads and writes view-state exclusively through this interface, so
 * the storage medium is a pluggable seam rather than a hardcoded filesystem
 * call. The CLI and TUI keep the filesystem (`FileViewStore`); the cloud Worker
 * keeps it in a per-user Durable Object (`DurableObjectViewStore`, in apps/cloud).
 *
 * The blob is the whole `view-state.json` record: the XState persisted snapshot
 * fields (`value`, `context`, `status`, …) plus the sidecar fields (`revision`,
 * `lastAction`, `recentQueries`). Stores treat it as opaque JSON.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ViewBlob = Record<string, unknown>;

export interface ViewStore {
  /** Read the whole blob. Missing/corrupt storage returns `{}`. */
  read(): Promise<ViewBlob>;
  /** Overwrite the whole blob. */
  write(blob: ViewBlob): Promise<void>;
}

/** In-memory store — the default for tests and any fs-free dispatch path. */
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

/**
 * Filesystem-backed store — the local CLI/TUI home for view-state. Reads return
 * `{}` on a missing or corrupt file; writes are atomic (tmp file + rename).
 */
export class FileViewStore implements ViewStore {
  constructor(private readonly path: string) {}

  async read(): Promise<ViewBlob> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as ViewBlob;
    } catch {
      return {};
    }
  }

  async write(blob: ViewBlob): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(blob, null, 2), "utf8");
    renameSync(tmp, this.path);
  }
}
