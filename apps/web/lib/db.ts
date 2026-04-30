import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as schema from "@crux/core/db/schema";

function resolveDbUrl(): string {
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL;
  const cruxHome = process.env.CRUX_HOME
    ? resolve(process.env.CRUX_HOME)
    : join(homedir(), ".claude", ".crux");
  return `file:${join(cruxHome, "crux.db")}`;
}

type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

let singleton: CruxDb | null = null;

export function db(): CruxDb {
  if (singleton) return singleton;
  const client = createClient({ url: resolveDbUrl() });
  singleton = drizzle(client, { schema });
  return singleton;
}
