import { env, reset } from "cloudflare:test";
import { createD1Db, type CruxDb } from "../../src/db/client.js";
import { applyMigrations } from "../../src/db/migrate.js";
import { migrationFiles } from "./migrations.js";
import { problems, solutions, users, workstreams, observations } from "../../src/db/schema.js";

/**
 * A D1-backed `CruxDb` with the committed migrations applied.
 *
 * Wipes the binding first, so every test starts from an empty database.
 */
export async function migratedDb(): Promise<CruxDb> {
  await reset();
  const db = createD1Db(env.DB);
  await applyMigrations(env.DB, migrationFiles());
  return db;
}

export const TEST_USER = "USR-tester";

/** Seed the rows every transition needs to exist: a user and a workstream. */
export async function seedBase(db: CruxDb): Promise<void> {
  await db.insert(users).values({ id: TEST_USER, slug: "tester", name: "Tester" });
  await db.insert(workstreams).values({ id: "WS-test", slug: "test", title: "Test workstream" });
}

export async function addProblem(db: CruxDb, title = "A problem"): Promise<number> {
  const [row] = await db
    .insert(problems)
    .values({
      workstreamId: "WS-test",
      title,
      description: "why it matters",
      createdById: TEST_USER,
    })
    .returning({ id: problems.id });
  return row!.id;
}

export async function addSolution(
  db: CruxDb,
  problemId: number,
  overrides: { title?: string; status?: string } = {},
): Promise<number> {
  const [row] = await db
    .insert(solutions)
    .values({
      problemId,
      title: overrides.title ?? "An option",
      status: overrides.status ?? "proposed",
      createdById: TEST_USER,
    })
    .returning({ id: solutions.id });
  return row!.id;
}

export async function addObservation(
  db: CruxDb,
  id: string,
  content = "a signal",
): Promise<string> {
  await db
    .insert(observations)
    .values({ id, workstreamId: "WS-test", reporterId: TEST_USER, content });
  return id;
}
