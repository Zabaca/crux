/**
 * The two pure halves of the corpus load: turning source rows into SQL, and
 * deciding afterwards whether what arrived matches what was sent.
 *
 * Kept separate from the script that runs wrangler so both can be tested
 * without a network, an account, or a database.
 */

/** A SQLite value as the libSQL client hands it back. */
export type CorpusValue = string | number | bigint | null;

export type CorpusTable = {
  table: string;
  columns: readonly string[];
  rows: readonly (readonly CorpusValue[])[];
};

/**
 * Load order. Every table appears after everything it references, because D1
 * enforces foreign keys and there is no deferral outside a transaction.
 *
 * `ideas` is deliberately absent: Idea stopped being an entity when migration
 * 0004 merged it into Observation, and the one row still sitting in the laptop
 * database is an archived probe ("Flag-probing leftover — never a real idea").
 */
export const CORPUS_TABLES: readonly { table: string }[] = [
  { table: "users" },
  { table: "workstreams" },
  { table: "observations" },
  { table: "problems" },
  { table: "solutions" },
  { table: "evidence" },
  { table: "eliminations" },
  { table: "elimination_solutions" },
  { table: "decisions" },
  { table: "decision_rejected_solutions" },
  { table: "abandonments" },
  { table: "outcomes" },
  { table: "outcome_follow_up_problems" },
];

/**
 * A SQLite string literal that contains no raw newline.
 *
 * SQLite is perfectly happy with a newline inside `'…'`, but the tools that
 * carry these statements around are not: wrangler splits a `--file` on line
 * boundaries, so an Observation whose content spans lines arrives as several
 * fragments, each a syntax error or — worse — a partial row that trips a
 * foreign key. Splicing line breaks out with `char(10)` keeps every statement
 * on one line and the round-tripped value byte-identical.
 */
function literal(value: CorpusValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);

  // A quote is escaped by doubling it; nothing else needs escaping.
  const quoted = value.replace(/'/g, "''");
  if (!/[\n\r]/.test(quoted)) return `'${quoted}'`;

  return quoted
    .split(/(\r|\n)/)
    .filter((part) => part !== "")
    .map((part) => (part === "\n" ? "char(10)" : part === "\r" ? "char(13)" : `'${part}'`))
    .join("||");
}

/**
 * Render tables as one INSERT statement per row, in the order given.
 *
 * Statements are returned as a list rather than one blob so the caller decides
 * how to apply them, and so nothing has to re-split text that may contain
 * anything at all. Tables with no rows are skipped — an INSERT with an empty
 * VALUES list is a syntax error, and an empty table needs no statement.
 */
export function buildCorpusDump(tables: readonly CorpusTable[]): string[] {
  const statements: string[] = [];
  for (const { table, columns, rows } of tables) {
    if (rows.length === 0) continue;
    const cols = columns.map((c) => `"${c}"`).join(",");
    for (const row of rows) {
      statements.push(`INSERT INTO "${table}" (${cols}) VALUES (${row.map(literal).join(",")});`);
    }
  }
  return statements;
}

/**
 * Every column that attributes a row to a person.
 *
 * These are the references most likely to dangle in the laptop corpus, because
 * migration 0005 rebuilt `problems`, `solutions`, `evidence`, `decisions` and
 * friends without their FOREIGN KEY clauses. SQLite never enforced what was no
 * longer declared, so `PRAGMA foreign_key_check` on the source reports nothing
 * while rows quietly cite authors who have no `users` row. D1 enforces the
 * schema as written, and finds them all at once.
 */
export const AUTHOR_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  workstreams: ["owner_id"],
  observations: ["reporter_id", "archived_by_id"],
  problems: ["created_by_id"],
  evidence: ["created_by_id"],
  solutions: ["created_by_id"],
  eliminations: ["created_by_id"],
  decisions: ["decided_by_id"],
  abandonments: ["abandoned_by_id"],
  outcomes: ["recorded_by_id"],
};

/**
 * Author ids the corpus cites that have no row in `users`, in first-seen order.
 *
 * The corpus rows themselves are real discovery work and have to survive the
 * move; what is missing is only the record of who wrote them. Dropping the rows
 * would lose the work, and reassigning them to the live user would quietly
 * rewrite authorship — so the loader materialises the absent author instead and
 * says exactly what it created.
 */
export function missingAuthorIds(
  tables: readonly CorpusTable[],
  presentUserIds: readonly string[],
): string[] {
  const present = new Set(presentUserIds);
  const missing = new Set<string>();
  for (const { table, columns, rows } of tables) {
    const authorColumns = AUTHOR_COLUMNS[table];
    if (!authorColumns) continue;
    const indexes = authorColumns.map((c) => columns.indexOf(c)).filter((i) => i >= 0);
    for (const row of rows) {
      for (const i of indexes) {
        const value = row[i];
        if (typeof value === "string" && value !== "" && !present.has(value)) missing.add(value);
      }
    }
  }
  return [...missing];
}

/** Columns of the placeholder row `missingAuthorIds` implies. */
export const PLACEHOLDER_USER_COLUMNS = ["id", "slug", "name", "email", "created_at"] as const;

/**
 * A stand-in `users` row for an author the corpus cites but does not define.
 *
 * The name is the id verbatim rather than something invented, so nobody later
 * mistakes it for a real person's record.
 */
export function placeholderUser(id: string, createdAt: number): CorpusValue[] {
  return [id, id.replace(/^USR-/, ""), id, null, createdAt];
}

/**
 * One query returning one row: a scalar sub-select per table.
 *
 * The obvious `SELECT 'users', COUNT(*) … UNION ALL …` shape does not survive
 * D1, which rejects a 13-term compound with "too many terms in compound SELECT"
 * (SQLITE_ERROR 7500). Scalar subqueries are not a compound select, so this
 * stays one round trip however many tables the corpus grows to.
 */
export function countsQuery(tables: readonly { table: string }[]): string {
  const columns = tables
    .map((t) => `(SELECT COUNT(*) FROM "${t.table}") AS "${t.table}"`)
    .join(", ");
  return `SELECT ${columns}`;
}

/** Read the single row `countsQuery` returns back into a per-table map. */
export function parseCounts(
  row: Readonly<Record<string, unknown>> | undefined,
): Record<string, number> {
  if (!row) return {};
  return Object.fromEntries(Object.entries(row).map(([table, n]) => [table, Number(n)]));
}

export type CountMismatch = { table: string; source: number; target: number };

/**
 * Compare per-table row counts. A table missing from the target counts as zero
 * rather than as agreement — "we never looked" must not read as "it matched".
 */
export function reconcileCounts(
  source: Readonly<Record<string, number>>,
  target: Readonly<Record<string, number>>,
): { ok: boolean; mismatches: CountMismatch[] } {
  const mismatches: CountMismatch[] = [];
  for (const [table, expected] of Object.entries(source)) {
    const actual = target[table] ?? 0;
    if (actual !== expected) mismatches.push({ table, source: expected, target: actual });
  }
  return { ok: mismatches.length === 0, mismatches };
}
