import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.js";

/**
 * The Crux database handle. D1 is the driver (ADR-0004); the drizzle
 * `sqliteTable` schema in ./schema.ts is shared and unchanged.
 */
export type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

/** Wrap a D1 binding (`env.DB`) in the schema-aware drizzle handle. */
export function createD1Db(binding: D1Database): CruxDb {
  return drizzle(binding, { schema });
}

let singleton: CruxDb | null = null;

/**
 * The database bound for this request/process.
 *
 * There is no lazy self-initialization: a D1 binding only exists inside a
 * Worker request, so the caller binds it with `setDb()` first.
 */
export function getDb(): CruxDb {
  if (!singleton) {
    throw new Error("No database bound — call setDb(createD1Db(env.DB)) first");
  }
  return singleton;
}

/**
 * Bind the db handle. Pass `null` to unbind.
 */
export function setDb(db: CruxDb | null): void {
  singleton = db;
}

/** A single statement queued for an atomic write. */
export type CruxWrite = BatchItem<"sqlite">;

/**
 * Apply `writes` all-or-nothing.
 *
 * D1 has no interactive transactions — `BEGIN`/`SAVEPOINT` are rejected by the
 * runtime — so `batch()` is the atomicity primitive: the statements run in
 * order inside one implicit transaction and roll back together. Transitions
 * only ever write inside their atomic block (no reads), which is exactly what
 * batch supports.
 *
 * Foreign keys are enforced statement by statement, so a batch must never pass
 * through a state that violates one — see `renameWorkstream` for the shape that
 * takes.
 */
export async function atomically(db: CruxDb, writes: ReadonlyArray<CruxWrite>): Promise<void> {
  if (writes.length === 0) return;
  await db.batch(writes as unknown as [CruxWrite, ...CruxWrite[]]);
}

export { schema };
