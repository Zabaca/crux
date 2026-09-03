/**
 * Slug-rename transition for workstreams.
 *
 * A Workstream id is opaque, so a rename touches one row and moves no
 * references — the deferred-FK batch this used to need went with the derived
 * primary key (ADR-0016).
 *
 * Whether the new slug is free is a question about the caller's scope, which
 * this layer does not have, so `actions/mutations.ts` asks it — the same way it
 * does for `ADD_WORKSTREAM`, and backed by the `(owner_id, slug)` index.
 */
import { eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { workstreams } from "../db/schema.js";
import { NotFoundError, TransitionError } from "./errors.js";

export type RenameUpdates = {
  title?: string;
  description?: string;
};

export type RenameResult = {
  kind: "workstream";
  /** Unchanged by the rename — kept in the result because callers report it. */
  id: string;
  oldSlug: string;
  newSlug: string;
};

export async function renameWorkstream(
  id: string,
  newSlug: string,
  updates: RenameUpdates,
  db: CruxDb,
): Promise<RenameResult> {
  if (!newSlug) {
    throw new TransitionError(`rename requires a non-empty newSlug`, { kind: "workstream", id });
  }

  const existing = (await db.select().from(workstreams).where(eq(workstreams.id, id)).limit(1))[0];
  if (!existing) {
    throw new NotFoundError(`workstream not found: ${id}`, { kind: "workstream", id });
  }

  const set: Partial<typeof workstreams.$inferInsert> = { updatedAt: Date.now(), slug: newSlug };
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  await db.update(workstreams).set(set).where(eq(workstreams.id, id));

  return { kind: "workstream", id, oldSlug: existing.slug, newSlug };
}
