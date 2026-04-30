import { and, eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { ideas } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

/**
 * Archive an Idea with a rationale.
 *
 * Terminal. No un-archive. Keyed by (workstreamId, slug) since ideas are
 * slug-addressed inside a workstream.
 */
export async function archiveIdea(
  workstreamId: string,
  slug: string,
  rationale: string,
  userId: string,
  db: CruxDb,
) {
  const rows = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.workstreamId, workstreamId), eq(ideas.slug, slug)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Idea not found in workstream: ${slug}`, { workstreamId, slug });
  }
  if (row.archivedAt !== null) {
    throw new TransitionError(`Idea ${row.id} is already archived`, {
      ideaId: row.id,
      archivedAt: row.archivedAt,
    });
  }
  const now = Date.now();
  await db
    .update(ideas)
    .set({
      archivedAt: now,
      archivedById: userId,
      archiveRationale: rationale,
      updatedAt: now,
    })
    .where(eq(ideas.id, row.id));
  return { id: row.id };
}
