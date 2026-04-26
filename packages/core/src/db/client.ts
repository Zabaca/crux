import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { homedir } from "node:os";
import { join } from "node:path";
import * as schema from "./schema.js";

export type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Resolve the Crux libSQL url.
 * Honors `CRUX_DB_URL`, else defaults to `file:$XDG_DATA_HOME/crux/crux.db`
 * with `$XDG_DATA_HOME` falling back to `$HOME/.local/share` (XDG spec).
 */
export function resolveDbUrl(override?: string): string {
  if (override) return override;
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return `file:${join(dataHome, "crux", "crux.db")}`;
}

let singleton: CruxDb | null = null;

export function getDb(url?: string): CruxDb {
  if (singleton) return singleton;
  const client = createClient({ url: resolveDbUrl(url) });
  singleton = drizzle(client, { schema });
  return singleton;
}

export { schema };
