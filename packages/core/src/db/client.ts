import type { BatchItem } from "drizzle-orm/batch";
import { drizzle } from "drizzle-orm/d1";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema.js";

/**
 * A Crux database handle.
 *
 * Deliberately the driver-agnostic drizzle supertype rather than a concrete
 * driver's type: the cloud runs on D1, while the CLI and the corpus loader
 * still hold libSQL handles against local files. Both satisfy this, so every
 * transition and query in core is written once and runs on either.
 *
 * Core does not resolve connections. A D1 binding has no URL and exists only
 * for the life of a request, so there is nothing here to cache and no ambient
 * database to reach for — callers construct a handle and pass it in.
 */
export type CruxDb = BaseSQLiteDatabase<"async", unknown, typeof schema> & {
  // `batch` lives on each concrete driver rather than on the shared supertype,
  // with an identical signature on both. See `runBatch` for why core needs it.
  batch<U extends BatchItem<"sqlite">, T extends Readonly<[U, ...U[]]>>(batch: T): Promise<unknown>;
};

/** Wrap a D1 binding as a Crux database handle. */
export function createD1Db(binding: D1Database): CruxDb {
  return drizzle(binding, { schema }) as unknown as CruxDb;
}

/**
 * Run statements atomically — all of them commit, or none do.
 *
 * D1 has no interactive transactions: it rejects `BEGIN TRANSACTION` outright
 * ("please use the state.storage.transaction() APIs instead"), so drizzle's
 * `db.transaction(cb)` throws the moment the callback opens. `batch()` is the
 * atomic primitive D1 does offer — one implicit transaction around a list of
 * statements — and libSQL implements it with the same signature.
 *
 * The trade is that statements are fixed up front and cannot read each other's
 * results. Every transition that needed atomicity already computed its writes
 * before opening a transaction, so nothing was lost in the swap.
 *
 * An empty list is a no-op; `batch` itself rejects one.
 */
export async function runBatch(db: CruxDb, statements: BatchItem<"sqlite">[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

export { schema };
