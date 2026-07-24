/**
 * Slug-rename transition for workstreams.
 *
 * Renaming a workstream changes its primary key (id = "WS-<slug>"), which
 * means every FK referrer must be updated in lockstep. FKs are declared without
 * ON UPDATE CASCADE, so the rename runs as one atomic batch shaped copy →
 * repoint → drop: the new row exists before anything points at it and the old
 * one goes away only once nothing does, so no intermediate state violates a
 * foreign key.
 */
import { eq } from "drizzle-orm";
import { atomically, type CruxDb, type CruxWrite } from "../db/client.js";
import { observations, problems, workstreams } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

export type RenameUpdates = {
  title?: string;
  description?: string;
};

export type RenameResult = {
  kind: "workstream";
  oldId: string;
  newId: string;
  oldSlug: string;
  newSlug: string;
};

/** Every table carrying a workstream id, which must move with the PK. */
function referrerUpdates(db: CruxDb, oldId: string, newId: string): CruxWrite[] {
  return [
    db
      .update(observations)
      .set({ workstreamId: newId })
      .where(eq(observations.workstreamId, oldId)),
    db.update(problems).set({ workstreamId: newId }).where(eq(problems.workstreamId, oldId)),
  ];
}

export async function renameWorkstream(
  oldSlug: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
): Promise<RenameResult> {
  if (!oldSlug || !newSlug) {
    throw new TransitionError(`rename requires non-empty oldSlug and newSlug`, {
      kind: "workstream",
      oldSlug,
      newSlug,
    });
  }

  const existing = (
    await db.select().from(workstreams).where(eq(workstreams.slug, oldSlug)).limit(1)
  )[0];
  if (!existing) {
    throw new NotFoundError(`workstream not found: ${oldSlug}`, {
      kind: "workstream",
      slug: oldSlug,
    });
  }

  if (newSlug !== oldSlug) {
    const collision = (
      await db.select().from(workstreams).where(eq(workstreams.slug, newSlug)).limit(1)
    )[0];
    if (collision) {
      throw new TransitionError(`workstream slug already taken: ${newSlug}`, {
        kind: "workstream",
        oldSlug,
        newSlug,
      });
    }
  }

  const oldId = `WS-${oldSlug}`;
  const newId = `WS-${newSlug}`;
  const now = Date.now();

  const edits = {
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    updatedAt: now,
  };

  const writes: CruxWrite[] =
    oldId === newId
      ? [db.update(workstreams).set(edits).where(eq(workstreams.id, oldId))]
      : [
          // Copy → repoint → drop. Every step is valid under enforced foreign
          // keys, so the batch never needs FK enforcement relaxed.
          db.insert(workstreams).values({ ...existing, ...edits, id: newId, slug: newSlug }),
          ...referrerUpdates(db, oldId, newId),
          db.delete(workstreams).where(eq(workstreams.id, oldId)),
        ];

  await atomically(db, writes);

  return { kind: "workstream", oldId, newId, oldSlug, newSlug };
}
