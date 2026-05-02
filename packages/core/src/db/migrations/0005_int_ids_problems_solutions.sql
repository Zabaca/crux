-- Migration 0005: drop slug columns from problems/solutions, switch to integer autoincrement PKs.
-- All FK columns referencing problems.id or solutions.id are migrated to INTEGER.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
-- Build old text ID → new integer ID mapping for problems (preserve created_at order).
CREATE TEMP TABLE _prob_map AS
WITH ordered AS (
  SELECT id AS old_id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM problems
)
SELECT old_id, CAST(rn AS INTEGER) AS new_id FROM ordered;
--> statement-breakpoint
-- Build old text ID → new integer ID mapping for solutions (preserve created_at order).
CREATE TEMP TABLE _sol_map AS
WITH ordered AS (
  SELECT id AS old_id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM solutions
)
SELECT old_id, CAST(rn AS INTEGER) AS new_id FROM ordered;
--> statement-breakpoint
-- ── problems ──────────────────────────────────────────────────────────────────
CREATE TABLE problems_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workstream_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT,
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO problems_new (id, workstream_id, title, description, status, created_by_id, created_at, updated_at)
  SELECT m.new_id, p.workstream_id, p.title, p.description, p.status, p.created_by_id, p.created_at, p.updated_at
  FROM problems p JOIN _prob_map m ON p.id = m.old_id;
--> statement-breakpoint
-- ── solutions ─────────────────────────────────────────────────────────────────
CREATE TABLE solutions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  effort TEXT,
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO solutions_new (id, problem_id, title, description, status, effort, created_by_id, created_at, updated_at)
  SELECT sm.new_id, pm.new_id, s.title, s.description, s.status, s.effort, s.created_by_id, s.created_at, s.updated_at
  FROM solutions s
  JOIN _sol_map sm ON s.id = sm.old_id
  JOIN _prob_map pm ON s.problem_id = pm.old_id;
--> statement-breakpoint
-- ── evidence ──────────────────────────────────────────────────────────────────
CREATE TABLE evidence_new (
  id TEXT NOT NULL PRIMARY KEY,
  observation_id TEXT NOT NULL,
  problem_id INTEGER NOT NULL,
  note TEXT,
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO evidence_new
  SELECT e.id, e.observation_id, pm.new_id, e.note, e.created_by_id, e.created_at
  FROM evidence e JOIN _prob_map pm ON e.problem_id = pm.old_id;
--> statement-breakpoint
-- ── eliminations ──────────────────────────────────────────────────────────────
CREATE TABLE eliminations_new (
  id TEXT NOT NULL PRIMARY KEY,
  problem_id INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  context TEXT,
  created_by_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO eliminations_new
  SELECT el.id, pm.new_id, el.rationale, el.context, el.created_by_id, el.created_at
  FROM eliminations el JOIN _prob_map pm ON el.problem_id = pm.old_id;
--> statement-breakpoint
-- ── elimination_solutions ─────────────────────────────────────────────────────
CREATE TABLE elimination_solutions_new (
  elimination_id TEXT NOT NULL,
  solution_id INTEGER NOT NULL,
  PRIMARY KEY (elimination_id, solution_id)
);
--> statement-breakpoint
INSERT INTO elimination_solutions_new
  SELECT es.elimination_id, sm.new_id
  FROM elimination_solutions es JOIN _sol_map sm ON es.solution_id = sm.old_id;
--> statement-breakpoint
-- ── decisions ─────────────────────────────────────────────────────────────────
CREATE TABLE decisions_new (
  id TEXT NOT NULL PRIMARY KEY,
  problem_id INTEGER NOT NULL,
  chosen_solution_id INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  context TEXT,
  decided_by_id TEXT NOT NULL,
  supersedes_decision_id TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO decisions_new
  SELECT d.id, pm.new_id, sm.new_id, d.rationale, d.context, d.decided_by_id, d.supersedes_decision_id, d.created_at
  FROM decisions d
  JOIN _prob_map pm ON d.problem_id = pm.old_id
  JOIN _sol_map sm ON d.chosen_solution_id = sm.old_id;
--> statement-breakpoint
-- ── decision_rejected_solutions ───────────────────────────────────────────────
CREATE TABLE decision_rejected_solutions_new (
  decision_id TEXT NOT NULL,
  solution_id INTEGER NOT NULL,
  PRIMARY KEY (decision_id, solution_id)
);
--> statement-breakpoint
INSERT INTO decision_rejected_solutions_new
  SELECT drs.decision_id, sm.new_id
  FROM decision_rejected_solutions drs JOIN _sol_map sm ON drs.solution_id = sm.old_id;
--> statement-breakpoint
-- ── abandonments ──────────────────────────────────────────────────────────────
CREATE TABLE abandonments_new (
  id TEXT NOT NULL PRIMARY KEY,
  problem_id INTEGER NOT NULL UNIQUE,
  rationale TEXT NOT NULL,
  abandoned_by_id TEXT NOT NULL,
  abandoned_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO abandonments_new
  SELECT 'ABN-' || CAST(pm.new_id AS TEXT), pm.new_id, ab.rationale, ab.abandoned_by_id, ab.abandoned_at
  FROM abandonments ab JOIN _prob_map pm ON ab.problem_id = pm.old_id;
--> statement-breakpoint
-- ── outcomes ──────────────────────────────────────────────────────────────────
CREATE TABLE outcomes_new (
  id TEXT NOT NULL PRIMARY KEY,
  solution_id INTEGER NOT NULL UNIQUE,
  observed_impact TEXT NOT NULL,
  expected_impact TEXT,
  learnings TEXT,
  recorded_by_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO outcomes_new
  SELECT o.id, sm.new_id, o.observed_impact, o.expected_impact, o.learnings, o.recorded_by_id, o.observed_at
  FROM outcomes o JOIN _sol_map sm ON o.solution_id = sm.old_id;
--> statement-breakpoint
-- ── outcome_follow_up_problems ────────────────────────────────────────────────
CREATE TABLE outcome_follow_up_problems_new (
  outcome_id TEXT NOT NULL,
  problem_id INTEGER NOT NULL,
  PRIMARY KEY (outcome_id, problem_id)
);
--> statement-breakpoint
INSERT INTO outcome_follow_up_problems_new
  SELECT ofp.outcome_id, pm.new_id
  FROM outcome_follow_up_problems ofp JOIN _prob_map pm ON ofp.problem_id = pm.old_id;
--> statement-breakpoint
-- ── swap tables ───────────────────────────────────────────────────────────────
DROP TABLE outcome_follow_up_problems;
--> statement-breakpoint
ALTER TABLE outcome_follow_up_problems_new RENAME TO outcome_follow_up_problems;
--> statement-breakpoint
DROP TABLE outcomes;
--> statement-breakpoint
ALTER TABLE outcomes_new RENAME TO outcomes;
--> statement-breakpoint
DROP TABLE abandonments;
--> statement-breakpoint
ALTER TABLE abandonments_new RENAME TO abandonments;
--> statement-breakpoint
DROP TABLE decision_rejected_solutions;
--> statement-breakpoint
ALTER TABLE decision_rejected_solutions_new RENAME TO decision_rejected_solutions;
--> statement-breakpoint
DROP TABLE decisions;
--> statement-breakpoint
ALTER TABLE decisions_new RENAME TO decisions;
--> statement-breakpoint
DROP TABLE elimination_solutions;
--> statement-breakpoint
ALTER TABLE elimination_solutions_new RENAME TO elimination_solutions;
--> statement-breakpoint
DROP TABLE eliminations;
--> statement-breakpoint
ALTER TABLE eliminations_new RENAME TO eliminations;
--> statement-breakpoint
DROP TABLE evidence;
--> statement-breakpoint
ALTER TABLE evidence_new RENAME TO evidence;
--> statement-breakpoint
DROP TABLE solutions;
--> statement-breakpoint
ALTER TABLE solutions_new RENAME TO solutions;
--> statement-breakpoint
DROP TABLE problems;
--> statement-breakpoint
ALTER TABLE problems_new RENAME TO problems;
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_obs_problem_unique ON evidence (observation_id, problem_id);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
