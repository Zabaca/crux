import { sqliteTable, text, integer, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Crux entity schema.
 *
 * Conventions:
 * - Primary keys are prefixed, human-readable ids (WS-<slug>, PRB-<slug>, OBS-###, …).
 * - Timestamps are integer epoch ms.
 * - `archived_at` replaces status columns on Observation/Idea.
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // USR-<slug>
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
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
  id: text("id").primaryKey(), // PRB-<slug>
  slug: text("slug").notNull().unique(),
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
    problemId: text("problem_id")
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

export const solutions = sqliteTable("solutions", {
  id: text("id").primaryKey(), // SOL-<slug>
  slug: text("slug").notNull().unique(),
  problemId: text("problem_id")
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
  problemId: text("problem_id")
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
    solutionId: text("solution_id")
      .notNull()
      .references(() => solutions.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eliminationId, t.solutionId] }) }),
);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(), // DEC-###
  problemId: text("problem_id")
    .notNull()
    .references(() => problems.id),
  chosenSolutionId: text("chosen_solution_id")
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
    solutionId: text("solution_id")
      .notNull()
      .references(() => solutions.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.decisionId, t.solutionId] }) }),
);

export const abandonments = sqliteTable("abandonments", {
  id: text("id").primaryKey(), // ABN-<problem-id>
  problemId: text("problem_id")
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
  solutionId: text("solution_id")
    .notNull()
    .references(() => solutions.id)
    .unique(),
  observedImpact: text("observed_impact").notNull(),
  expectedImpact: text("expected_impact"),
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
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.outcomeId, t.problemId] }) }),
);
