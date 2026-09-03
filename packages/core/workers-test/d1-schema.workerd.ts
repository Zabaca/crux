import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { applyD1Schema } from "../src/db/d1/index.js";

// Seam: `applyD1Schema(d1)` — the whole of "the drizzle schema is applied to
// D1". Storage is shared across tests in a file under vitest-pool-workers
// 0.18 (`isolatedStorage` is gone), so each test starts from `reset()`.

/**
 * Every table the entity model needs, written out by hand from CONTEXT.md's
 * entity list plus the one link table the model implies. Independent of
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
  "attempts",
  "abandonments",
  "outcomes",
  "outcome_follow_up_problems",
  // Not an entity: the pending half of claiming, which is what makes proving an
  // address before writing its edge possible at all (ADR-0013).
  "claims",
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

  test("a fresh users table carries removed_at, unset", async () => {
    await applyD1Schema(env.DB);
    await env.DB.prepare(
      `insert into users (id, slug, name, email, created_at) values (?, ?, ?, ?, ?)`,
    )
      .bind("USR-james", "james", "James Lee", "james@zabaca.com", 1_700_000_000_000)
      .run();

    const row = await env.DB.prepare(`select removed_at from users where id = ?`)
      .bind("USR-james")
      .first<{ removed_at: number | null }>();
    // Null, not 0: a Member who has never been removed has no removal time.
    expect(row?.removed_at).toBeNull();
  });

  test("adds removed_at to a users table that predates it", async () => {
    // The shape a deployment created before Better Auth landed still has —
    // `CREATE TABLE IF NOT EXISTS` states an end state only for a database that
    // does not have the table yet, so this is the path production takes.
    await env.DB.prepare(
      `CREATE TABLE users (
        id text PRIMARY KEY NOT NULL,
        slug text NOT NULL,
        name text NOT NULL,
        email text,
        created_at integer NOT NULL
      )`,
    ).run();
    await env.DB.prepare(
      `insert into users (id, slug, name, email, created_at) values (?, ?, ?, ?, ?)`,
    )
      .bind("USR-james", "james", "James Lee", "james@zabaca.com", 1_700_000_000_000)
      .run();

    await applyD1Schema(env.DB);

    const row = await env.DB.prepare(
      `select name, removed_at, updated_at, claimed_by_user_id from users where id = ?`,
    )
      .bind("USR-james")
      .first<{
        name: string;
        removed_at: number | null;
        updated_at: number;
        claimed_by_user_id: string | null;
      }>();
    expect(row?.name).toBe("James Lee");
    expect(row?.removed_at).toBeNull();
    // Claiming's edge (ADR-0013) reaches an old database the same way: an
    // additive column, unset, which reads as "this Principal is its own human".
    expect(row?.claimed_by_user_id).toBeNull();
    // The pre-existing row is still there and still a Member — an added column
    // must not read as "removed" for everyone who was there before it existed.
    expect(row?.updated_at).toBe(1_700_000_000_000);
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

  test("workstream slugs are unique per owner, not per deployment", async () => {
    await applyD1Schema(env.DB);
    const user = async (id: string) =>
      env.DB.prepare(`insert into users (id, slug, name) values (?, ?, ?)`).bind(id, id, id).run();
    const workstream = (id: string, slug: string, owner: string) =>
      env.DB.prepare(`insert into workstreams (id, slug, title, owner_id) values (?, ?, ?, ?)`)
        .bind(id, slug, slug, owner)
        .run();
    await user("USR-a");
    await user("USR-b");

    await workstream("WS-a", "crux", "USR-a");
    // Another owner may hold the same name — the whole point.
    await workstream("WS-b", "crux", "USR-b");
    // The same owner may not.
    await expect(workstream("WS-a2", "crux", "USR-a")).rejects.toThrow(/UNIQUE/i);
  });

  test("drops the deployment-wide slug index a database created before this had", async () => {
    // The path production takes: the index exists, and `CREATE ... IF NOT
    // EXISTS` alone would leave it enforcing exactly what this replaces.
    await applyD1Schema(env.DB);
    await env.DB.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS workstreams_slug_unique ON workstreams (slug)`,
    ).run();

    await applyD1Schema(env.DB);

    const row = await env.DB.prepare(
      `select name from sqlite_master where type = 'index' and name = ?`,
    )
      .bind("workstreams_slug_unique")
      .first<{ name: string }>();
    expect(row).toBeNull();
  });
});
