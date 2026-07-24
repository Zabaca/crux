/**
 * The legacy single-machine libSQL path.
 *
 * Cloud crux is client-server with D1 as the only database (ADR-0003/0004), so
 * this exists purely to keep the local CLI and the Next.js app running until
 * CRUX-UJ12D4 removes the local-database path. Nothing in the Worker imports
 * it — `@libsql/client` and `node:fs` must stay out of that bundle.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { join } from "node:path";
import { resolveCruxHome } from "../config/user.js";
import { setDb, type CruxDb } from "./client.js";
import * as schema from "./schema.js";

/**
 * Resolve the local libSQL url.
 * Honors `CRUX_DB_URL` (explicit override), else `$CRUX_HOME/crux.db`
 * where `CRUX_HOME` defaults to `~/.claude/.crux`.
 */
export function resolveDbUrl(override?: string): string {
  if (override) return override;
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  return `file:${join(resolveCruxHome(), "crux.db")}`;
}

/**
 * Bind the process-wide db handle to a local libSQL file.
 *
 * The drivers differ only in their result types — the drizzle sqliteTable
 * schema and every query built from it are shared — so the handle is bridged
 * to `CruxDb`. Only the local path relies on this bridge.
 */
export function bindLocalDb(url?: string): CruxDb {
  const client = createClient({ url: resolveDbUrl(url) });
  const db = drizzle(client, { schema }) as unknown as CruxDb;
  setDb(db);
  return db;
}
