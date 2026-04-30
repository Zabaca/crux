import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { join } from "node:path";
import * as schema from "./schema.js";
import { resolveCruxHome } from "../config/user.js";

export type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Resolve the Crux libSQL url.
 * Honors `CRUX_DB_URL` (explicit override), else `$CRUX_HOME/crux.db`
 * where `CRUX_HOME` defaults to `~/.claude/.crux`.
 */
export function resolveDbUrl(override?: string): string {
  if (override) return override;
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  return `file:${join(resolveCruxHome(), "crux.db")}`;
}

let singleton: CruxDb | null = null;

export function getDb(url?: string): CruxDb {
  if (singleton) return singleton;
  const client = createClient({ url: resolveDbUrl(url) });
  singleton = drizzle(client, { schema });
  return singleton;
}

/**
 * Override the singleton db handle — used by tests to inject an ephemeral db.
 * Pass `null` to reset so the next `getDb()` call re-initializes from the URL.
 */
export function setDb(db: CruxDb | null): void {
  singleton = db;
}

export { schema };
