import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as schema from "./schema.js";

export type CruxTestDb = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_DIR = new URL("./migrations", import.meta.url).pathname;

async function applyMigrations(d: CruxTestDb): Promise<void> {
  // libSQL migrations live as .sql files in db/migrations. We can't pull in
  // drizzle-kit at test time; just execute each statement file in order.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sqlText = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    // statement-breakpoint splits drizzle-generated migration files
    const stmts = sqlText
      .split(/--> statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of stmts) {
      // @ts-expect-error using session for raw exec
      await d.session.client.execute(stmt);
    }
  }
}

export interface TestDb {
  db: CruxTestDb;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Creates an ephemeral, file-backed libSQL database in a temp directory with
 * all migrations applied. Call `cleanup()` in afterEach to remove the files.
 */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "crux-test-"));
  const dbPath = join(dir, "test.db");
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client, { schema });
  await applyMigrations(db);
  return {
    db,
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
