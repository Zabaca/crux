/**
 * Dropping the corpus.
 *
 * `applyD1Schema` states an end state and only ever adds: a table removed from
 * `D1_SCHEMA_STATEMENTS` stays in production forever, and a column repointed at
 * a different parent is a table rebuild that additive DDL cannot express. The
 * escape hatch is to start the database over — a deliberate, human-gated act,
 * so it lives here rather than as a `destroy()` on the D1 infra module where
 * `zbc destroy` could reach it.
 *
 * Nothing the Worker serves imports this module. Its one caller is
 * `scripts/rebuild-production-db.ts`, over the Cloudflare REST API; the
 * indirection through an injected runner is what lets the same logic be tested
 * against a real SQLite database rather than only against production.
 */

/** The tables SQLite and D1 own. Dropping one is either an error or a lie. */
const RESERVED = /^(sqlite_|_cf_|d1_)/;

export interface SqlRunner {
  /** Run a statement. Rejects on SQL error — the pass loop reads that. */
  exec(sql: string): Promise<void>;
  /** Read rows back. Only `sqlite_master` is ever queried through this. */
  all(sql: string): Promise<Array<Record<string, unknown>>>;
}

export interface SchemaObject {
  name: string;
  /** `table`, `view`, `index` or `trigger`, as SQLite reports it. */
  type: string;
}

/** Everything in the database that is not SQLite's or D1's own bookkeeping. */
export async function listSchemaObjects(runner: SqlRunner): Promise<SchemaObject[]> {
  const rows = await runner.all("SELECT name, type FROM sqlite_master ORDER BY type, name");
  return rows
    .map((r) => ({ name: String(r["name"]), type: String(r["type"]) }))
    .filter((o) => !RESERVED.test(o.name));
}

const DROP_KEYWORD: Record<string, string> = {
  table: "TABLE",
  view: "VIEW",
  index: "INDEX",
  trigger: "TRIGGER",
};

/**
 * Drop everything `listSchemaObjects` finds, leaving the database empty.
 *
 * Foreign keys make the order matter, and the order that works is not knowable
 * from `sqlite_master` alone. So this makes repeated passes, keeping what
 * failed for the next one: a pass that drops nothing is either done or
 * genuinely stuck, and the second case throws with the survivors named — and
 * each one's last error, because a stalled pass is just as likely to be an
 * expired token or a rate limit as a drop-order problem, and the operator
 * reading this is half-way through emptying a production database.
 *
 * Every statement is `IF EXISTS` and the object list is re-read from
 * `sqlite_master` on entry, so a throw leaves a half-dropped database that
 * calling this again finishes.
 *
 * Returns the names dropped, in the order they went.
 */
export async function dropAll(runner: SqlRunner): Promise<string[]> {
  const dropped: string[] = [];
  // Triggers and indexes first: they are the dependents, and dropping them up
  // front means the table passes below are only ever fighting foreign keys.
  let remaining = (await listSchemaObjects(runner)).sort((a, b) => order(a.type) - order(b.type));

  while (remaining.length > 0) {
    const failed: Array<{ object: SchemaObject; error: unknown }> = [];
    for (const object of remaining) {
      const keyword = DROP_KEYWORD[object.type];
      if (!keyword) throw new Error(`Unknown sqlite_master type "${object.type}" (${object.name})`);
      try {
        await runner.exec(`DROP ${keyword} IF EXISTS "${object.name}"`);
        dropped.push(object.name);
      } catch (error) {
        failed.push({ object, error });
      }
    }
    if (failed.length === remaining.length) {
      const detail = failed
        .map(
          (f) =>
            `${f.object.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`,
        )
        .join("\n  ");
      throw new Error(
        `A pass dropped nothing, so ${failed.length} object(s) are stuck — this may be a ` +
          `foreign key that outlives them, or the connection itself:\n  ${detail}`,
      );
    }
    remaining = failed.map((f) => f.object);
  }

  return dropped;
}

function order(type: string): number {
  if (type === "trigger") return 0;
  if (type === "index") return 1;
  if (type === "view") return 2;
  return 3;
}
