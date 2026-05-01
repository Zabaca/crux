-- Merge Idea → Observation (drop Idea entity)
-- 1. Map each idea to next available OBS-### ID
CREATE TEMP TABLE _idea_obs_map AS
WITH max_seq AS (
  SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS v FROM observations
),
ranked AS (
  SELECT id AS old_id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM ideas
)
SELECT old_id, 'OBS-' || PRINTF('%03d', max_seq.v + ranked.rn) AS new_id
FROM ranked, max_seq;

-- 2. Insert ideas as plain observations (title → content)
INSERT INTO observations
  (id, workstream_id, reporter_id, content, source, source_type, tags,
   created_at, updated_at, archived_at, archived_by_id, archive_rationale)
SELECT
  m.new_id, i.workstream_id, i.reporter_id,
  i.title,
  NULL, NULL, i.tags,
  i.created_at, i.updated_at, i.archived_at, i.archived_by_id, i.archive_rationale
FROM ideas i JOIN _idea_obs_map m ON i.id = m.old_id;

-- 3. Drop originating_idea_id from solutions
CREATE TABLE solutions_new AS SELECT
  id, slug, problem_id, title, description, effort, status,
  created_by_id, created_at, updated_at
FROM solutions;
DROP TABLE solutions;
ALTER TABLE solutions_new RENAME TO solutions;

-- 4. Drop ideas table
DROP TABLE ideas;
