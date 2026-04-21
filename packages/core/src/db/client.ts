import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

export type CruxDb = ReturnType<typeof drizzle<typeof schema>>;

let singleton: CruxDb | null = null;

export function getDb(url?: string): CruxDb {
  if (singleton) return singleton;
  const resolved = url ?? process.env.CRUX_DB_URL ?? "file:.crux.db";
  const client = createClient({ url: resolved });
  singleton = drizzle(client, { schema });
  return singleton;
}

export { schema };
