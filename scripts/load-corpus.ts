#!/usr/bin/env bun
/**
 * One-shot: copy the laptop corpus into Cloudflare D1.
 *
 * Run it with the deploy credential in the environment, the same secret store
 * zbc uses:
 *
 *   sops exec-env packages/infra/environments/production/secrets.yaml \
 *     'bun run scripts/load-corpus.ts'
 *
 * Add `--replace` to wipe the cloud tables first; without it the script refuses
 * to touch a database that already has rows.
 *
 * The source database is never opened. It is copied to a scratch file and the
 * copy is read, so nothing — not even a `-wal` sidecar from opening SQLite
 * read-write — lands next to the original.
 */
import { createClient } from "@libsql/client";
import { D1_SCHEMA_STATEMENTS } from "@crux/core/db/d1";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  CORPUS_TABLES,
  PLACEHOLDER_USER_COLUMNS,
  buildCorpusDump,
  countsQuery,
  missingAuthorIds,
  parseCounts,
  placeholderUser,
  reconcileCounts,
  type CorpusTable,
} from "./corpus/dump.js";

const WRANGLER_CONFIG = "apps/cloud/wrangler.jsonc";
const REPLACE = process.argv.includes("--replace");

function sourceDbPath(): string {
  if (process.env.CRUX_DB_URL) return process.env.CRUX_DB_URL.replace(/^file:/, "");
  const home = process.env.CRUX_HOME ?? join(homedir(), ".claude", ".crux");
  return join(home, "crux.db");
}

/** The database name from the Worker's own config — one source of truth. */
function databaseName(): string {
  const raw = readFileSync(WRANGLER_CONFIG, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const parsed = JSON.parse(raw) as { d1_databases?: { database_name?: string }[] };
  const name = parsed.d1_databases?.[0]?.database_name;
  if (!name) throw new Error(`no d1_databases[0].database_name in ${WRANGLER_CONFIG}`);
  return name;
}

function wrangler(args: string[]): string {
  // Plain `bunx`, never `bunx --bun`: wrangler on the Bun runtime misreports
  // success (see the deploy note in README).
  const res = spawnSync("bunx", ["wrangler@4", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `wrangler ${args.slice(0, 3).join(" ")} failed (exit ${res.status}):\n${res.stderr || res.stdout}`,
    );
  }
  return res.stdout;
}

/** Run SQL against the remote database and return the first result set. */
function remoteQuery(db: string, sql: string): Record<string, unknown>[] {
  const out = wrangler(["d1", "execute", db, "--remote", "--json", "--command", sql]);
  // wrangler prefixes human-readable lines before the JSON payload.
  const start = out.indexOf("[");
  const parsed = JSON.parse(out.slice(start)) as { results?: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
}

function remoteFile(db: string, sqlPath: string): void {
  wrangler(["d1", "execute", db, "--remote", "--yes", "--file", sqlPath]);
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "crux-corpus-"));
try {
  const db = databaseName();
  const source = sourceDbPath();

  // --- read the source, without touching it -------------------------------
  const copy = join(scratch, "source.db");
  copyFileSync(source, copy);
  const client = createClient({ url: `file:${copy}` });

  const tables: (CorpusTable & { rows: readonly (readonly never[])[] })[] = [];
  const sourceCounts: Record<string, number> = {};
  for (const { table } of CORPUS_TABLES) {
    const result = await client.execute(`SELECT * FROM "${table}"`);
    tables.push({
      table,
      columns: result.columns,
      rows: result.rows.map((r) => result.columns.map((c) => r[c] as never)),
    });
    sourceCounts[table] = result.rows.length;
  }
  console.log(`source: ${source}`);

  // --- authors the corpus cites but never defined --------------------------
  const usersTable = tables.find((t) => t.table === "users")!;
  const idColumn = usersTable.columns.indexOf("id");
  const missing = missingAuthorIds(
    tables,
    usersTable.rows.map((r) => String(r[idColumn])),
  );
  if (missing.length > 0) {
    const now = Date.now();
    console.log(
      `\n! ${missing.length} author(s) referenced by the corpus have no users row: ${missing.join(", ")}`,
    );
    console.log("  Creating a placeholder row for each so the rows that cite them survive with");
    console.log("  their attribution intact. Nothing is reassigned to another user.");
    // Emit in the source table's column order, not the constant's.
    usersTable.rows = [
      ...usersTable.rows,
      ...missing.map((id) => {
        const values = placeholderUser(id, now);
        return usersTable.columns.map((column) => {
          const i = PLACEHOLDER_USER_COLUMNS.indexOf(column as never);
          return i >= 0 ? (values[i] ?? null) : null;
        });
      }),
    ];
    sourceCounts.users = usersTable.rows.length;
  }

  const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
  console.log(`        ${total} rows across ${CORPUS_TABLES.length} tables`);

  // --- schema (idempotent) -------------------------------------------------
  const schemaPath = join(scratch, "schema.sql");
  writeFileSync(schemaPath, `${D1_SCHEMA_STATEMENTS.join(";\n")};\n`);
  console.log(`\napplying schema to ${db}…`);
  remoteFile(db, schemaPath);

  // --- refuse to load over existing rows -----------------------------------
  const before = parseCounts(remoteQuery(db, countsQuery(CORPUS_TABLES))[0]);
  const existing = Object.values(before).reduce((a, b) => a + b, 0);
  if (existing > 0 && !REPLACE) {
    fail(
      `${db} already holds ${existing} rows. Re-run with --replace to wipe and reload, ` +
        `or investigate before overwriting.`,
    );
  }
  if (existing > 0) {
    const wipePath = join(scratch, "wipe.sql");
    // Children first — the mirror of the load order.
    writeFileSync(
      wipePath,
      [...CORPUS_TABLES]
        .reverse()
        .map((t) => `DELETE FROM "${t.table}";`)
        .join("\n"),
    );
    console.log(`--replace: clearing ${existing} existing rows…`);
    remoteFile(db, wipePath);
  }

  // --- load ----------------------------------------------------------------
  const dumpPath = join(scratch, "corpus.sql");
  writeFileSync(dumpPath, `${buildCorpusDump(tables).join("\n")}\n`);
  console.log(`loading ${total} rows…`);
  remoteFile(db, dumpPath);

  // --- verify: per-table counts -------------------------------------------
  const after = parseCounts(remoteQuery(db, countsQuery(CORPUS_TABLES))[0]);
  const { ok, mismatches } = reconcileCounts(sourceCounts, after);
  console.log("\nrow counts:");
  for (const { table } of CORPUS_TABLES) {
    const n = sourceCounts[table] ?? 0;
    const got = after[table] ?? 0;
    console.log(`  ${n === got ? "✓" : "✗"} ${table.padEnd(30)} ${String(n).padStart(4)} → ${got}`);
  }
  if (!ok) {
    fail(
      `row counts do not match:\n${mismatches
        .map((m) => `    ${m.table}: expected ${m.source}, found ${m.target}`)
        .join("\n")}`,
    );
  }

  // --- verify: relationships survived --------------------------------------
  // Each check runs the same query on the source copy and on D1 and compares —
  // the source is the expected value, so a shared bug in one query cannot make
  // a broken load look healthy.
  const spotChecks: { name: string; sql: string }[] = [
    {
      name: "Problem with the most Evidence, and its Observations",
      sql: `SELECT e.problem_id, e.observation_id FROM evidence e
            WHERE e.problem_id = (SELECT problem_id FROM evidence GROUP BY problem_id
                                  ORDER BY COUNT(*) DESC, problem_id LIMIT 1)
            ORDER BY e.observation_id`,
    },
    {
      name: "Decision with rejected Solutions, and their statuses",
      sql: `SELECT d.id, d.chosen_solution_id, r.solution_id, s.status
            FROM decisions d
            JOIN decision_rejected_solutions r ON r.decision_id = d.id
            JOIN solutions s ON s.id = r.solution_id
            WHERE d.id = (SELECT decision_id FROM decision_rejected_solutions
                          GROUP BY decision_id ORDER BY COUNT(*) DESC, decision_id LIMIT 1)
            ORDER BY r.solution_id`,
    },
    {
      name: "Outcome and the shipped Solution it closes",
      sql: `SELECT o.id, o.solution_id, s.status, s.problem_id
            FROM outcomes o JOIN solutions s ON s.id = o.solution_id
            ORDER BY o.id LIMIT 1`,
    },
  ];

  console.log("\nspot checks:");
  let allMatched = true;
  for (const check of spotChecks) {
    const result = await client.execute(check.sql);
    const expected = result.rows.map((row) =>
      JSON.stringify(result.columns.map((c) => row[c] ?? null)),
    );
    const actual = remoteQuery(db, check.sql).map((row) =>
      JSON.stringify(result.columns.map((c) => row[c] ?? null)),
    );
    // An empty result proves nothing, so it fails rather than passes vacuously.
    const matched = expected.length > 0 && JSON.stringify(expected) === JSON.stringify(actual);
    allMatched &&= matched;
    console.log(`  ${matched ? "✓" : "✗"} ${check.name} (${expected.length} rows)`);
    if (!matched) {
      console.error(`      source: ${expected.join(" | ")}`);
      console.error(`      d1:     ${actual.join(" | ")}`);
    }
  }
  if (!allMatched) fail("relationships did not survive the load");

  console.log(`\n✓ ${total} rows in ${db}; counts and relationships verified.`);
  console.log(`  source untouched: ${source}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
