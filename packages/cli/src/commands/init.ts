import { defineCommand } from "citty";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDbUrl } from "@crux/core/db";
import { MIGRATIONS_DIR } from "@crux/core/db/migrations-path";
import { emit, setJsonMode } from "../output.js";

function dbFilePath(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  return url.slice("file:".length);
}

export const initCommand = defineCommand({
  meta: {
    name: "init",
    description: "Create the Crux database (if needed) and run pending migrations.",
  },
  args: {
    "db-url": { type: "string", description: "Override CRUX_DB_URL for this invocation." },
    json: { type: "boolean" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const url = resolveDbUrl(args["db-url"]);
    const filePath = dbFilePath(url);

    let createdDir = false;
    let dbExisted = false;
    if (filePath) {
      dbExisted = existsSync(filePath);
      const parent = dirname(filePath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
        createdDir = true;
      }
    }

    const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const client = createClient({ url });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    client.close();

    emit(
      {
        ok: true,
        dbUrl: url,
        dbPath: filePath,
        createdParentDir: createdDir,
        dbExisted,
        migrationsApplied: migrationFiles.length,
      },
      `initialized ${url}${createdDir ? " (created parent dir)" : ""} — ${migrationFiles.length} migration(s) known`,
    );
  },
});
