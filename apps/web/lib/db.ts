import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { homedir } from "node:os";
import { join } from "node:path";
import * as schema from "@crux/core/db/schema";

/**
 * Resolve the Crux libSQL url the same way `@crux/core`'s `resolveDbUrl`
 * does. Inlined here because importing `@crux/core/db` pulls in a
 * MIGRATIONS_DIR `new URL("./migrations", import.meta.url)` that webpack
 * can't statically resolve. We don't need migrations at runtime — only
 * read access to the seeded `.crux.db`.
 */
function resolveDbUrl(): string {
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return `file:${join(dataHome, "crux", "crux.db")}`;
}

type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

let singleton: CruxDb | null = null;

export function db(): CruxDb {
  if (singleton) return singleton;
  const client = createClient({ url: resolveDbUrl() });
  singleton = drizzle(client, { schema });
  return singleton;
}
