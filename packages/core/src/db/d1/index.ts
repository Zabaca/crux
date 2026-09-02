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
  // `users` is the one identity table: a CLI bearer token and a browser session
  // both resolve to a row here (see `auth/better-auth.ts`). The trailing four
  // columns are Better Auth's half of it — `db/auth-schema.ts` is the typed view
  // that reads them as Dates.
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    email text,
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    email_verified integer DEFAULT 0 NOT NULL,
    image text,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    removed_at integer
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_slug_unique ON users (slug)`,
  // Partial, because `users.email` is nullable and predates Better Auth: rows
  // seeded by the CLI have no address, and several NULLs must stay legal.
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email) WHERE email IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token text NOT NULL,
    expires_at integer NOT NULL,
    ip_address text,
    user_agent text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_unique ON auth_sessions (token)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions (user_id)`,

  `CREATE TABLE IF NOT EXISTS auth_accounts (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at integer,
    refresh_token_expires_at integer,
    scope text,
    password text,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_accounts_user_id ON auth_accounts (user_id)`,

  `CREATE TABLE IF NOT EXISTS auth_verifications (
    id text PRIMARY KEY NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at integer NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS auth_verifications_identifier ON auth_verifications (identifier)`,

  // The whole of membership: no Workspace table, no roles. An invite is a
  // one-time permission to create a `users` row (ADR-0003).
  `CREATE TABLE IF NOT EXISTS invites (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    invited_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    expires_at integer NOT NULL,
    accepted_at integer,
    accepted_user_id text REFERENCES users(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invites_token_hash_unique ON invites (token_hash)`,

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

  // An Attempt points at work in another tracker (ADR-0012). No description
  // column, deliberately: `ref` is authoritative for what the work is, and
  // `closing_note` is the judgment no tracker keeps.
  `CREATE TABLE IF NOT EXISTS attempts (
    id text PRIMARY KEY NOT NULL,
    problem_id integer NOT NULL REFERENCES problems(id),
    ref text NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'open' NOT NULL,
    closing_note text,
    created_by_id text NOT NULL REFERENCES users(id),
    created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
    updated_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS attempts_problem_id ON attempts (problem_id)`,

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
    problem_id integer NOT NULL REFERENCES problems(id),
    observed_impact text NOT NULL,
    learnings text,
    recorded_by_id text NOT NULL REFERENCES users(id),
    observed_at integer DEFAULT (unixepoch() * 1000) NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS outcomes_problem_id_unique ON outcomes (problem_id)`,

  `CREATE TABLE IF NOT EXISTS outcome_follow_up_problems (
    outcome_id text NOT NULL REFERENCES outcomes(id),
    problem_id integer NOT NULL REFERENCES problems(id),
    PRIMARY KEY (outcome_id, problem_id)
  )`,
];

/**
 * Columns added to a table that already exists.
 *
 * `CREATE TABLE IF NOT EXISTS` states an end state only for a database that
 * does not have the table yet; a deployment whose `users` predates Better Auth
 * keeps its four-column shape forever. SQLite has no `ADD COLUMN IF NOT EXISTS`,
 * so these run one at a time and a "duplicate column name" is the success case
 * on the second run. Every column here must also appear in the `CREATE TABLE`
 * above, which is what a fresh database gets.
 *
 * A trailing backfill is allowed here too — it must be idempotent, since this
 * list runs on every apply. Note these statements are only ever exercised
 * against a legacy-shaped database: on a fresh one the `CREATE TABLE` already
 * carries the columns, so every ALTER short-circuits as a duplicate and the
 * tests never reach the code path production depends on.
 */
export const D1_ADD_COLUMNS: readonly string[] = [
  `ALTER TABLE users ADD COLUMN email_verified integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE users ADD COLUMN image text`,
  // Constant default, unlike the `CREATE TABLE` above: SQLite rejects
  // `ADD COLUMN` with a non-constant default ("Cannot add a column with
  // non-constant default"), so `(unixepoch() * 1000)` is legal only on a fresh
  // table. The backfill below gives the pre-existing rows a truthful value.
  `ALTER TABLE users ADD COLUMN updated_at integer DEFAULT 0 NOT NULL`,
  `UPDATE users SET updated_at = created_at WHERE updated_at = 0`,
  `ALTER TABLE users ADD COLUMN removed_at integer`,
];

/**
 * Apply the entity schema to a D1 database. Safe to call on a database that
 * already has it — every statement is `IF NOT EXISTS` or an additive column
 * whose duplicate is ignored, so a second run changes nothing and touches no
 * rows.
 */
export async function applyD1Schema(d1: D1Database): Promise<void> {
  await d1.batch(D1_SCHEMA_STATEMENTS.map((sql) => d1.prepare(sql)));
  for (const sql of D1_ADD_COLUMNS) {
    try {
      await d1.prepare(sql).run();
    } catch (err) {
      if (!isDuplicateColumn(err)) throw err;
    }
  }
}

function isDuplicateColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate column name/i.test(message);
}
