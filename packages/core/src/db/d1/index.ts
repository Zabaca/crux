/**
 * The entity schema as idempotent DDL, plus the one call that applies it to a
 * D1 database.
 *
 * Why this exists rather than replaying `db/migrations/*.sql`: those migrations
 * are a *history* — 0002 collapses a status column, 0004 merges Idea into
 * Observation, 0005 rewrites two primary keys — and replaying that history onto
 * an empty database is a fragile way to reach a state we can state directly.
 * D1 also has no drizzle-kit: there is no migrator that can read files at
 * runtime inside workerd. So the cloud database is defined by its *end state*,
 * expressed as `CREATE TABLE IF NOT EXISTS`, which makes reapplying it a no-op
 * by construction.
 *
 * These statements must stay in step with `../schema.ts`, which remains the
 * single definition the query layer is built from (drizzle's `sqliteTable`
 * works on both drivers, so the schema module itself needed no changes).
 * `workers-test/d1-schema.workerd.ts` fails if a table goes missing here.
 */

/** Parent-first: every `references` target is created before its dependents. */
export const D1_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    email text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_slug_unique ON users (slug)`,

  `CREATE TABLE IF NOT EXISTS api_tokens (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id),
    token_hash text NOT NULL,
    name text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    revoked_at integer
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_unique ON api_tokens (token_hash)`,

  `CREATE TABLE IF NOT EXISTS workstreams (
    id text PRIMARY KEY NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text,
    owner_id text REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    archived_at integer
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS workstreams_slug_unique ON workstreams (slug)`,

  `CREATE TABLE IF NOT EXISTS observations (
    id text PRIMARY KEY NOT NULL,
    workstream_id text NOT NULL REFERENCES workstreams(id),
    reporter_id text NOT NULL REFERENCES users(id),
    content text NOT NULL,
    source text,
    source_type text,
    tags text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    archived_at integer,
    archived_by_id text REFERENCES users(id),
    archive_rationale text
  )`,

  `CREATE TABLE IF NOT EXISTS problems (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    workstream_id text NOT NULL REFERENCES workstreams(id),
    title text NOT NULL,
    description text NOT NULL,
    status text,
    created_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS evidence (
    id text PRIMARY KEY NOT NULL,
    observation_id text NOT NULL REFERENCES observations(id),
    problem_id integer NOT NULL REFERENCES problems(id),
    note text,
    created_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS evidence_obs_problem_unique ON evidence (observation_id, problem_id)`,

  `CREATE TABLE IF NOT EXISTS solutions (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    problem_id integer NOT NULL REFERENCES problems(id),
    title text NOT NULL,
    description text,
    status text DEFAULT 'proposed' NOT NULL,
    effort text,
    created_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS eliminations (
    id text PRIMARY KEY NOT NULL,
    problem_id integer NOT NULL REFERENCES problems(id),
    rationale text NOT NULL,
    context text,
    created_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS elimination_solutions (
    elimination_id text NOT NULL REFERENCES eliminations(id),
    solution_id integer NOT NULL REFERENCES solutions(id),
    PRIMARY KEY (elimination_id, solution_id)
  )`,

  `CREATE TABLE IF NOT EXISTS decisions (
    id text PRIMARY KEY NOT NULL,
    problem_id integer NOT NULL REFERENCES problems(id),
    chosen_solution_id integer NOT NULL REFERENCES solutions(id),
    rationale text NOT NULL,
    context text,
    decided_by_id text NOT NULL REFERENCES users(id),
    supersedes_decision_id text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS decision_rejected_solutions (
    decision_id text NOT NULL REFERENCES decisions(id),
    solution_id integer NOT NULL REFERENCES solutions(id),
    PRIMARY KEY (decision_id, solution_id)
  )`,

  `CREATE TABLE IF NOT EXISTS abandonments (
    id text PRIMARY KEY NOT NULL,
    problem_id integer NOT NULL REFERENCES problems(id),
    rationale text NOT NULL,
    abandoned_by_id text NOT NULL REFERENCES users(id),
    abandoned_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS abandonments_problem_id_unique ON abandonments (problem_id)`,

  `CREATE TABLE IF NOT EXISTS outcomes (
    id text PRIMARY KEY NOT NULL,
    solution_id integer NOT NULL REFERENCES solutions(id),
    observed_impact text NOT NULL,
    expected_impact text,
    learnings text,
    recorded_by_id text NOT NULL REFERENCES users(id),
    observed_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outcomes_solution_id_unique ON outcomes (solution_id)`,

  `CREATE TABLE IF NOT EXISTS outcome_follow_up_problems (
    outcome_id text NOT NULL REFERENCES outcomes(id),
    problem_id integer NOT NULL REFERENCES problems(id),
    PRIMARY KEY (outcome_id, problem_id)
  )`,
];

/**
 * Apply the entity schema to a D1 database. Safe to call on a database that
 * already has it — every statement is `IF NOT EXISTS`, so a second run changes
 * nothing and touches no rows.
 */
export async function applyD1Schema(d1: D1Database): Promise<void> {
  await d1.batch(D1_SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql)));
}
