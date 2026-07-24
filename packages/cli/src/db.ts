import { createClient } from "@libsql/client";
import { schema, type CruxDb } from "@crux/core/db";
import { userConfig } from "@crux/core";
import { drizzle } from "drizzle-orm/libsql";
import { join } from "node:path";

/**
 * The CLI's database handle.
 *
 * Core stopped resolving connections when the corpus moved to D1 — a binding
 * has no URL and lives only for a request — so URL resolution belongs to the
 * caller that still has one. That is this file, and only until the CLI becomes
 * a thin HTTP client against the cloud API, at which point libSQL leaves the
 * repo entirely.
 */

/**
 * Honors `CRUX_DB_URL` (explicit override), else `$CRUX_HOME/crux.db` where
 * `CRUX_HOME` defaults to `~/.claude/.crux`.
 */
export function resolveDbUrl(override?: string): string {
  if (override) return override;
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  return `file:${join(userConfig.resolveCruxHome(), "crux.db")}`;
}

let singleton: CruxDb | null = null;

export function getDb(url?: string): CruxDb {
  if (singleton) return singleton;
  const client = createClient({ url: resolveDbUrl(url) });
  singleton = drizzle(client, { schema }) as unknown as CruxDb;
  return singleton;
}

/**
 * Override the handle — used by tests to inject an ephemeral db.
 * Pass `null` to reset so the next `db()` call re-initializes from the URL.
 */
export function setDb(next: CruxDb | null): void {
  singleton = next;
}
