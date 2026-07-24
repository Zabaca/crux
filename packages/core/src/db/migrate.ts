/**
 * D1 migrator.
 *
 * Applies the committed drizzle migration SQL to a D1 database through the D1
 * driver. Deliberately takes the SQL as data rather than reading it: workerd
 * has no filesystem, so callers inline the files (Vite `?raw` imports in the
 * test suite, a build-time bundle in the Worker).
 */

/** One migration file: its filename (ordering key) and its raw SQL. */
export interface MigrationFile {
  name: string;
  sql: string;
}

/** Bookkeeping table recording which migrations a database has seen. */
export const JOURNAL_TABLE = "__crux_migrations";

/**
 * Split a drizzle-generated migration into individual statements.
 *
 * drizzle marks statement boundaries with `--> statement-breakpoint`; a file
 * with no marker (a hand-written single-statement migration) yields one entry.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function appliedMigrations(d1: D1Database): Promise<Set<string>> {
  await d1
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE} (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    )
    .run();
  const { results } = await d1.prepare(`SELECT name FROM ${JOURNAL_TABLE}`).all<{ name: string }>();
  return new Set(results.map((r) => r.name));
}

/**
 * Apply every migration the database has not seen yet, in filename order.
 * Idempotent — already-applied migrations are skipped. Returns the names
 * applied by this call.
 */
export async function applyMigrations(
  d1: D1Database,
  files: ReadonlyArray<MigrationFile>,
): Promise<string[]> {
  const already = await appliedMigrations(d1);
  const pending = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((f) => !already.has(f.name));

  const applied: string[] = [];
  for (const file of pending) {
    for (const stmt of splitStatements(file.sql)) {
      await d1.prepare(stmt).run();
    }
    await d1
      .prepare(`INSERT INTO ${JOURNAL_TABLE} (name, applied_at) VALUES (?, ?)`)
      .bind(file.name, Date.now())
      .run();
    applied.push(file.name);
  }
  return applied;
}
