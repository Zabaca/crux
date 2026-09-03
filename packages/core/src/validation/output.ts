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

/** { ok: true, id: string|number, status: string | null } — schedule / ship / abandon / outcome. */
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
    // Optional for the same reason `DigestProblemEntry.attempts` is: the CLI
    // ships as a plugin and is updated independently of the deployment it
    // points at, so a Problem from a Worker that predates Attempts must parse.
    attempts: z.array(z.unknown()).optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// View state (5 sites)
// ---------------------------------------------------------------------------

export const ViewStateOutput = z.object({ value: z.unknown() }).passthrough();

export const ViewPathOutput = z.object({ path: z.string() });
