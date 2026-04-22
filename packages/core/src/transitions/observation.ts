import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { observations } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

/**
 * Archive an Observation with a rationale.
 *
 * Terminal. No un-archive. Mirrors `abandonProblem` shape: preserves the row
 * (origin trail invariant) but sets `archivedAt`, `archivedById`, and
 * `archiveRationale` so future sessions see why it was taken out of queues.
 */
export async function archiveObservation(
  observationId: string,
  rationale: string,
  userId: string,
  db: CruxDb,
) {
  const rows = await db
    .select()
    .from(observations)
    .where(eq(observations.id, observationId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Observation not found: ${observationId}`, { observationId });
  }
  if (row.archivedAt !== null) {
    throw new TransitionError(`Observation ${observationId} is already archived`, {
      observationId,
      archivedAt: row.archivedAt,
    });
  }
  const now = Date.now();
  await db
    .update(observations)
    .set({
      archivedAt: now,
      archivedById: userId,
      archiveRationale: rationale,
      updatedAt: now,
    })
    .where(eq(observations.id, observationId));
}
