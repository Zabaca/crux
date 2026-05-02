/**
 * Output Zod schemas — validate the shape of every `emit()` payload before write.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

/** { ok: true, id: string|number } — add commands. passthrough() allows extra fields. */
export const OkWithIdOutput = z
  .object({ ok: z.literal(true), id: z.union([z.string(), z.number()]) })
  .passthrough();

/** { ok: true, kind, oldId, newId, oldSlug, newSlug } — rename commands. */
export const RenameOutput = z.object({
  ok: z.literal(true),
  kind: z.string(),
  oldId: z.string(),
  newId: z.string(),
  oldSlug: z.string(),
  newSlug: z.string(),
});

/** { ok: true, id: string|number, status: string | null } — schedule / ship / done / abandon. */
export const OkWithStatusOutput = z.object({
  ok: z.literal(true),
  id: z.union([z.string(), z.number()]),
  status: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Bespoke: problem show
// ---------------------------------------------------------------------------

export const ProblemShowOutput = z
  .object({
    id: z.union([z.string(), z.number()]),
    solutions: z.array(z.unknown()),
    latest_decision: z.unknown(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Bespoke: context
// ---------------------------------------------------------------------------

const DigestProblemEntry = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string(),
    status: z.string().nullable(),
    solutions: z.array(z.unknown()),
    latest_decision: z.unknown(),
  })
  .passthrough();

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
    seed_version: z.string(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// View state (5 sites)
// ---------------------------------------------------------------------------

export const ViewStateOutput = z.object({ value: z.unknown() }).passthrough();

export const ViewPathOutput = z.object({ path: z.string() });
