/**
 * Output Zod schemas — validate the shape of every `emit()` payload before write.
 *
 * Three shared schemas cover the bulk of command output:
 *   OkWithIdOutput     — { ok: true, id: string, ...any }
 *   RenameOutput       — { ok: true, kind, oldId, newId, oldSlug, newSlug }
 *   OkWithStatusOutput — { ok: true, id: string, status: string | null }
 *
 * Bespoke schemas guard the OBS-030 regression sites:
 *   ProblemShowOutput  — requires solutions[] and latest_decision at top level
 *   ContextOutput      — requires workstream + all tier buckets at top level
 *
 * ViewStateOutput covers the five view-state emit sites.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared schemas (~14 trivial commands + 5 rename + 4 status)
// ---------------------------------------------------------------------------

/** { ok: true, id: string } — add commands. passthrough() allows extra fields. */
export const OkWithIdOutput = z.object({ ok: z.literal(true), id: z.string() }).passthrough();

/** { ok: true, kind, oldId, newId, oldSlug, newSlug } — rename commands. */
export const RenameOutput = z.object({
  ok: z.literal(true),
  kind: z.string(),
  oldId: z.string(),
  newId: z.string(),
  oldSlug: z.string(),
  newSlug: z.string(),
});

/** { ok: true, id: string, status: string | null } — schedule / ship / done / abandon. */
export const OkWithStatusOutput = z.object({
  ok: z.literal(true),
  id: z.string(),
  status: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Bespoke: problem show  (OBS-030 b)
// ---------------------------------------------------------------------------

/**
 * problem show must spread solutions[] and latest_decision at top level —
 * not nest them under a `problem` key.
 */
export const ProblemShowOutput = z
  .object({
    id: z.string(),
    slug: z.string(),
    solutions: z.array(z.unknown()),
    latest_decision: z.unknown(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Bespoke: context  (OBS-030 a)
// ---------------------------------------------------------------------------

/** A digest problem entry must spread slug/title/status at top level. */
const DigestProblemEntry = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    // status is null for unscheduled — field must be present
    status: z.string().nullable(),
    solutions: z.array(z.unknown()),
    latest_decision: z.unknown(),
  })
  .passthrough();

/**
 * context --json must emit workstream + seed_version at top level.
 * Tier bucket fields (now, next, later, unscheduled, done, abandoned) and
 * top-level lists (recent_observations_unlinked, unpromoted_ideas, themes)
 * are optional — only emitted when the corresponding --tier or --all flag is set.
 * Regression guard: OBS-030 (a) fired when entries were nested under {problem:{...}}.
 */
export const ContextOutput = z
  .object({
    workstream: z.object({ slug: z.string() }).passthrough(),
    now: z.array(DigestProblemEntry).optional(),
    next: z.array(DigestProblemEntry).optional(),
    later: z.array(DigestProblemEntry).optional(),
    unscheduled: z.array(DigestProblemEntry).optional(),
    done: z.array(DigestProblemEntry).optional(),
    abandoned: z.array(DigestProblemEntry).optional(),
    recent_observations_unlinked: z.array(z.unknown()).optional(),
    unpromoted_ideas: z.array(z.unknown()).optional(),
    themes: z.array(z.unknown()).optional(),
    seed_version: z.string(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// View state (5 sites)
// ---------------------------------------------------------------------------

/** Shared shape for view get / send / reset / next payloads. */
export const ViewStateOutput = z.object({ value: z.unknown() }).passthrough();

/** view path — distinct shape: { path: string } */
export const ViewPathOutput = z.object({ path: z.string() });

// ---------------------------------------------------------------------------
// Theme attach
// ---------------------------------------------------------------------------

/** theme attach — { ok: true, themeId, solutionId } */
export const ThemeAttachOutput = z.object({
  ok: z.literal(true),
  themeId: z.string(),
  solutionId: z.string(),
});
