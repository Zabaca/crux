import { sqliteTable, text, integer, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Crux entity schema.
 *
 * Conventions:
 * - Workstreams: text PK "WS-<slug>", slug column kept for human-readable URLs.
 * - Problems/Solutions: integer autoincrement PK, no slug column.
 * - Other entities: prefixed text PKs (OBS-###, EVD-###, …).
 * - Timestamps are integer epoch ms.
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // USR-<slug>
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  /** When this Member was removed from the Workspace; null means active. The
   * row is never deleted, because every entity below cites it as its author. */
  removedAt: integer("removed_at"),
});

/**
 * API bearer tokens for the CLI. Only the SHA-256 hash of each token is stored;
 * `revoked_at` null means active. See `auth/tokens.ts`.
 */
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(), // TOK-<random>
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  revokedAt: integer("revoked_at"),
});

export const workstreams = sqliteTable("workstreams", {
  id: text("id").primaryKey(), // WS-<slug>
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  ownerId: text("owner_id").references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  archivedAt: integer("archived_at"),
});

export const observations = sqliteTable("observations", {
  id: text("id").primaryKey(), // OBS-###
  workstreamId: text("workstream_id")
    .notNull()
    .references(() => workstreams.id),
  reporterId: text("reporter_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  source: text("source"),
  /** internal | competitive | external | analysis | customer_report | metric_signal */
  sourceType: text("source_type"),
  tags: text("tags"), // JSON array string
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  archivedAt: integer("archived_at"),
  archivedById: text("archived_by_id").references(() => users.id),
  archiveRationale: text("archive_rationale"),
});

export const problems = sqliteTable("problems", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workstreamId: text("workstream_id")
    .notNull()
    .references(() => workstreams.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  /** now | next | later | done | abandoned. null = unscheduled (default). */
  status: text("status"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(), // EVD-###
    observationId: text("observation_id")
      .notNull()
      .references(() => observations.id),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id),
    note: text("note"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    obsProblemUnique: uniqueIndex("evidence_obs_problem_unique").on(t.observationId, t.problemId),
  }),
);

/**
 * An Attempt: a pointer to work happening somewhere else about a Problem
 * (ADR-0012).
 *
 * There is deliberately no `description` column. The work is described in the
 * system `ref` points at; a second copy here would rot while looking
 * trustworthy, which is the failure Crux exists to prevent. What Crux keeps
 * that no tracker does is `closing_note` — the backward-looking judgment about
 * why an attempt ended the way it did.
 *
 * `status` is a coarse local marker, not a mirror: nothing polls the linked
 * tracker, so it goes stale, and the `ref` stays authoritative. Its only job is
 * to answer the drift query — a Problem staged as active with zero open
 * Attempts.
 */
export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(), // ATT-###
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id),
  /** Where the work actually lives — a URL or a tracker key. Authoritative. */
  ref: text("ref").notNull(),
  label: text("label").notNull(),
  /** open | shipped | dropped */
  status: text("status").notNull().default("open"),
  /** Why the attempt ended the way it did. Null while open, required on close. */
  closingNote: text("closing_note"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const solutions = sqliteTable("solutions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id),
  title: text("title").notNull(),
  description: text("description"),
  /** proposed | evaluated | chosen | rejected | shipped */
  status: text("status").notNull().default("proposed"),
  /** S | M | L | XL — rough effort hint, nullable. */
  effort: text("effort"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const eliminations = sqliteTable("eliminations", {
  id: text("id").primaryKey(), // ELIM-###
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id),
  rationale: text("rationale").notNull(),
  context: text("context"),
  createdById: text("created_by_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const eliminationSolutions = sqliteTable(
  "elimination_solutions",
  {
    eliminationId: text("elimination_id")
      .notNull()
      .references(() => eliminations.id),
    solutionId: integer("solution_id")
      .notNull()
      .references(() => solutions.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eliminationId, t.solutionId] }) }),
);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(), // DEC-###
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id),
  chosenSolutionId: integer("chosen_solution_id")
    .notNull()
    .references(() => solutions.id),
  rationale: text("rationale").notNull(),
  context: text("context"),
  decidedById: text("decided_by_id")
    .notNull()
    .references(() => users.id),
  supersedesDecisionId: text("supersedes_decision_id"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const decisionRejectedSolutions = sqliteTable(
  "decision_rejected_solutions",
  {
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id),
    solutionId: integer("solution_id")
      .notNull()
      .references(() => solutions.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.decisionId, t.solutionId] }) }),
);

export const abandonments = sqliteTable("abandonments", {
  id: text("id").primaryKey(), // ABN-<integer-problem-id>
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id)
    .unique(),
  rationale: text("rationale").notNull(),
  abandonedById: text("abandoned_by_id")
    .notNull()
    .references(() => users.id),
  abandonedAt: integer("abandoned_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const outcomes = sqliteTable("outcomes", {
  id: text("id").primaryKey(), // OUT-###
  problemId: integer("problem_id")
    .notNull()
    .references(() => problems.id)
    .unique(),
  observedImpact: text("observed_impact").notNull(),
  learnings: text("learnings"),
  recordedById: text("recorded_by_id")
    .notNull()
    .references(() => users.id),
  observedAt: integer("observed_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const outcomeFollowUpProblems = sqliteTable(
  "outcome_follow_up_problems",
  {
    outcomeId: text("outcome_id")
      .notNull()
      .references(() => outcomes.id),
    problemId: integer("problem_id")
      .notNull()
      .references(() => problems.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.outcomeId, t.problemId] }) }),
);
