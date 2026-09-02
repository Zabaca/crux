/**
 * The drop plan, against a real SQLite database carrying the real schema.
 *
 * The point of the round trip is that it is the *same* `D1_SCHEMA_STATEMENTS`
 * production gets: a table added to the schema module is automatically covered
 * here, so the wipe cannot quietly stop being total.
 */
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { D1_SCHEMA_STATEMENTS } from "../index.js";
import { dropAll, listSchemaObjects, type SqlRunner } from "../rebuild.js";

function runnerFor(db: Database): SqlRunner {
  return {
    exec: async (sql) => {
      db.run(sql);
    },
    all: async (sql) => db.query(sql).all() as Array<Record<string, unknown>>,
  };
}

function seeded(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  for (const sql of D1_SCHEMA_STATEMENTS) db.run(sql);
  return db;
}

describe("dropAll", () => {
  test("leaves nothing behind after the full schema is applied", async () => {
    const db = seeded();
    const runner = runnerFor(db);
    expect((await listSchemaObjects(runner)).length).toBeGreaterThan(0);

    const dropped = await dropAll(runner);

    expect(await listSchemaObjects(runner)).toEqual([]);
    expect(dropped).toContain("users");
    expect(dropped).toContain("problems");
  });

  test("drops tables that reference each other, whatever the order", async () => {
    const db = seeded();
    const runner = runnerFor(db);
    db.run("INSERT INTO users (id, slug, name) VALUES ('USR-t', 't', 'T')");
    db.run(
      "INSERT INTO workstreams (id, slug, title, owner_id) VALUES ('WS-t', 't', 'T', 'USR-t')",
    );

    await dropAll(runner);

    expect(await listSchemaObjects(runner)).toEqual([]);
  });

  test("leaves SQLite's own bookkeeping alone", async () => {
    const db = new Database(":memory:");
    const runner = runnerFor(db);
    // An INTEGER PRIMARY KEY AUTOINCREMENT is what creates `sqlite_sequence`.
    db.run("CREATE TABLE t (id integer PRIMARY KEY AUTOINCREMENT, v text)");
    db.run("INSERT INTO t (v) VALUES ('x')");

    expect(await dropAll(runner)).toEqual(["t"]);
    const left = db.query("SELECT name FROM sqlite_master").all() as Array<{ name: string }>;
    expect(left.map((r) => r.name)).toEqual(["sqlite_sequence"]);
  });

  test("reports what it could not drop rather than claiming success", async () => {
    const db = seeded();
    const runner = runnerFor(db);
    const stubborn: SqlRunner = {
      all: runner.all,
      exec: async (sql) => {
        if (sql.includes('"users"')) throw new Error("nope");
        await runner.exec(sql);
      },
    };

    await expect(dropAll(stubborn)).rejects.toThrow(/users/);
  });
});
