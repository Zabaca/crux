import type { MigrationFile } from "../../src/db/migrate.js";

/**
 * The committed migration SQL, inlined at build time by Vite so it is readable
 * inside workerd (which has no filesystem). Glob discovery means adding a
 * migration needs no edit here.
 */
const sources = import.meta.glob("../../src/db/migrations-d1/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export function migrationFiles(): MigrationFile[] {
  return Object.entries(sources)
    .map(([path, sql]) => ({ name: path.split("/").pop()!, sql }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
