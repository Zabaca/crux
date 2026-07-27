import { describe, expect, test } from "bun:test";

import {
  CORPUS_TABLES,
  buildCorpusDump,
  countsQuery,
  missingAuthorIds,
  parseCounts,
  placeholderUser,
  reconcileCounts,
} from "./dump.js";

// Seam: the two pure halves of the corpus load. The wrangler invocation that
// wraps them is a shell, not a seam — everything worth asserting is here.
//
// Expected SQL below is hand-written, not produced by re-running the builder's
// own escaping.

describe("buildCorpusDump", () => {
  test("writes one INSERT per row, columns in the order given", () => {
    const statements = buildCorpusDump([
      {
        table: "users",
        columns: ["id", "slug", "name"],
        rows: [["USR-james", "james", "James Lee"]],
      },
    ]);

    expect(statements).toEqual([
      `INSERT INTO "users" ("id","slug","name") VALUES ('USR-james','james','James Lee');`,
    ]);
  });

  test("escapes embedded single quotes by doubling them", () => {
    const statements = buildCorpusDump([
      { table: "problems", columns: ["title"], rows: [["it's broken"]] },
    ]);

    expect(statements).toEqual([`INSERT INTO "problems" ("title") VALUES ('it''s broken');`]);
  });

  test("emits numbers bare and null as NULL", () => {
    const statements = buildCorpusDump([
      {
        table: "problems",
        columns: ["id", "status", "created_at"],
        rows: [[7, null, 1_700_000_000_000]],
      },
    ]);

    expect(statements).toEqual([
      `INSERT INTO "problems" ("id","status","created_at") VALUES (7,NULL,1700000000000);`,
    ]);
  });

  test("skips a table with no rows rather than emitting empty VALUES", () => {
    const statements = buildCorpusDump([
      { table: "outcome_follow_up_problems", columns: ["outcome_id"], rows: [] },
      { table: "users", columns: ["id"], rows: [["USR-james"]] },
    ]);

    expect(statements).toEqual([`INSERT INTO "users" ("id") VALUES ('USR-james');`]);
  });

  test("preserves the order tables are given in, so parents land before children", () => {
    const statements = buildCorpusDump([
      { table: "workstreams", columns: ["id"], rows: [["WS-crux"]] },
      { table: "problems", columns: ["workstream_id"], rows: [["WS-crux"]] },
    ]);

    expect(statements[0]).toContain(`"workstreams"`);
    expect(statements[1]).toContain(`"problems"`);
  });

  test("never emits a raw newline, so no statement can be split in half", () => {
    const statements = buildCorpusDump([
      {
        table: "observations",
        columns: ["content"],
        rows: [["Discovery thinking vanishes\nwhen conversations end"]],
      },
    ]);

    expect(statements).toEqual([
      `INSERT INTO "observations" ("content") VALUES ('Discovery thinking vanishes'||char(10)||'when conversations end');`,
    ]);
    expect(statements[0]).not.toContain("\n");
  });

  test("splices carriage returns out too", () => {
    const statements = buildCorpusDump([
      { table: "observations", columns: ["content"], rows: [["a\r\nb"]] },
    ]);

    expect(statements).toEqual([
      `INSERT INTO "observations" ("content") VALUES ('a'||char(13)||char(10)||'b');`,
    ]);
  });

  test("one statement per row, so the loader can apply them one at a time", () => {
    const statements = buildCorpusDump([
      { table: "users", columns: ["id"], rows: [["USR-a"], ["USR-b"], ["USR-c"]] },
    ]);

    expect(statements).toHaveLength(3);
  });
});

describe("CORPUS_TABLES", () => {
  test("lists every parent before anything that references it", () => {
    const position = new Map(CORPUS_TABLES.map((t, i) => [t.table, i]));
    // Hand-written from the schema's `references(...)` clauses.
    const mustPrecede: ReadonlyArray<[string, string]> = [
      ["users", "workstreams"],
      ["workstreams", "observations"],
      ["workstreams", "problems"],
      ["observations", "evidence"],
      ["problems", "evidence"],
      ["problems", "solutions"],
      ["problems", "eliminations"],
      ["eliminations", "elimination_solutions"],
      ["solutions", "elimination_solutions"],
      ["solutions", "decisions"],
      ["decisions", "decision_rejected_solutions"],
      ["problems", "abandonments"],
      ["solutions", "outcomes"],
      ["outcomes", "outcome_follow_up_problems"],
    ];
    for (const [parent, child] of mustPrecede) {
      expect(position.get(parent), `${parent} missing`).toBeDefined();
      expect(position.get(child), `${child} missing`).toBeDefined();
      expect(position.get(parent)!, `${parent} must precede ${child}`).toBeLessThan(
        position.get(child)!,
      );
    }
  });
});

describe("missingAuthorIds", () => {
  test("finds an author referenced by the corpus but absent from users", () => {
    const missing = missingAuthorIds(
      [
        { table: "users", columns: ["id"], rows: [["USR-james"]] },
        {
          table: "problems",
          columns: ["id", "created_by_id"],
          rows: [
            [1, "USR-james"],
            [2, "USR-test"],
          ],
        },
      ],
      ["USR-james"],
    );

    expect(missing).toEqual(["USR-test"]);
  });

  test("reports each missing author once, however many rows cite it", () => {
    const missing = missingAuthorIds(
      [
        {
          table: "decisions",
          columns: ["decided_by_id"],
          rows: [["USR-test"], ["USR-test"], ["USR-test"]],
        },
      ],
      [],
    );

    expect(missing).toEqual(["USR-test"]);
  });

  test("scans every author column, not just the common one", () => {
    const missing = missingAuthorIds(
      [
        {
          table: "observations",
          columns: ["reporter_id", "archived_by_id"],
          rows: [["USR-james", "USR-archiver"]],
        },
      ],
      ["USR-james"],
    );

    expect(missing).toEqual(["USR-archiver"]);
  });

  test("ignores nulls — an unset author is not a missing one", () => {
    const missing = missingAuthorIds(
      [{ table: "observations", columns: ["archived_by_id"], rows: [[null]] }],
      [],
    );

    expect(missing).toEqual([]);
  });

  test("says nothing when every author is present", () => {
    const missing = missingAuthorIds(
      [{ table: "problems", columns: ["created_by_id"], rows: [["USR-james"]] }],
      ["USR-james"],
    );

    expect(missing).toEqual([]);
  });
});

describe("placeholderUser", () => {
  test("keeps the id verbatim so attribution stays traceable", () => {
    expect(placeholderUser("USR-test", 1_700_000_000_000)).toEqual([
      "USR-test",
      "test",
      "USR-test",
      null,
      1_700_000_000_000,
    ]);
  });
});

describe("countsQuery", () => {
  test("counts every table in one row", () => {
    const sql = countsQuery([{ table: "users" }, { table: "problems" }]);

    expect(sql).toBe(
      `SELECT (SELECT COUNT(*) FROM "users") AS "users", (SELECT COUNT(*) FROM "problems") AS "problems"`,
    );
  });

  test("uses no compound SELECT — D1 rejects one past a low term count", () => {
    const sql = countsQuery(CORPUS_TABLES);

    expect(sql).not.toContain("UNION");
  });

  test("round-trips through parseCounts", () => {
    expect(parseCounts({ users: 1, problems: "24" })).toEqual({ users: 1, problems: 24 });
  });

  test("parseCounts of no row is no counts, not a crash", () => {
    expect(parseCounts(undefined)).toEqual({});
  });
});

describe("reconcileCounts", () => {
  test("passes when every table matches", () => {
    const result = reconcileCounts({ users: 1, problems: 24 }, { users: 1, problems: 24 });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  test("reports the table, the expected count and what arrived", () => {
    const result = reconcileCounts({ users: 1, problems: 24 }, { users: 1, problems: 23 });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ table: "problems", source: 24, target: 23 }]);
  });

  test("treats a table absent from the target as zero rows, not as a match", () => {
    const result = reconcileCounts({ evidence: 66 }, {});

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ table: "evidence", source: 66, target: 0 }]);
  });
});
