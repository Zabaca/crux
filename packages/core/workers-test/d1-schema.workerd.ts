import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { applyD1Schema } from "../src/db/d1/index.js";

// Seam: `applyD1Schema(d1)` — the whole of "the drizzle schema is applied to
// D1". Storage is shared across tests in a file under vitest-pool-workers
// 0.18 (`isolatedStorage` is gone), so each test starts from `reset()`.

/**
 * Every table the entity model needs, written out by hand from CONTEXT.md's
 * entity list plus the three link tables the model implies. Independent of
 * whatever statements the implementation happens to emit — if the two drift,
 * that is the failure this test exists to catch.
 */
const EXPECTED_TABLES = [
  "users",
  "api_tokens",
  "workstreams",
  "observations",
  "problems",
  "evidence",
  "solutions",
  "eliminations",
  "elimination_solutions",
  "decisions",
  "decision_rejected_solutions",
  "abandonments",
  "outcomes",
  "outcome_follow_up_problems",
] as const;

beforeEach(async () => {
  await reset();
});

describe("applyD1Schema", () => {
  test("creates every table the entity model needs, each empty", async () => {
    await applyD1Schema(env.DB);

    for (const table of EXPECTED_TABLES) {
      const row = await env.DB.prepare(`select count(*) as n from "${table}"`).first<{
        n: number;
      }>();
      expect(row?.n, `table ${table}`).toBe(0);
    }
  });

  test("applying it twice is a no-op — existing rows survive", async () => {
    await applyD1Schema(env.DB);
    await env.DB.prepare(
      `insert into users (id, slug, name, email, created_at) values (?, ?, ?, ?, ?)`,
    )
      .bind("USR-james", "james", "James Lee", "james@zabaca.com", 1_700_000_000_000)
      .run();

    await applyD1Schema(env.DB);

    const row = await env.DB.prepare(`select name from users where id = ?`)
      .bind("USR-james")
      .first<{ name: string }>();
    expect(row?.name).toBe("James Lee");
  });
});
