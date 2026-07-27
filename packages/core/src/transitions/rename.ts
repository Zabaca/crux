/**
 * Slug-rename transition for workstreams.
 *
 * Renaming a workstream changes its primary key (id = "WS-<slug>"), so every FK
 * referrer has to move with it, and the intermediate states are all invalid:
 * point the referrers at the new id and they dangle until the parent row is
 * rewritten, rewrite the parent first and the referrers dangle instead. The
 * whole thing therefore has to land as one commit with FK checks held until the
 * end.
 *
 * `PRAGMA defer_foreign_keys = on` is how that is expressed on D1, which
 * enforces foreign keys with no way to switch them off. It applies to the
 * surrounding transaction only, which means it has to be the first statement of
 * the `batch()` it belongs to. The database then does the verifying at commit
 * and refuses the batch outright if anything dangles — replacing the older
 * dance of disabling enforcement globally and auditing by hand with
 * `PRAGMA foreign_key_check`.
 */
import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { runBatch, type CruxDb } from "../db/client.js";
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

/**
 * Every column that points at `workstreams.id`, as typed updates rather than
 * table/column name strings. drizzle's D1 `batch()` calls `.stmt.bind(...)` on
 * each statement, which a raw `db.run(sql`…`)` carrying parameters does not
 * have — so parameterised raw SQL cannot go in a batch at all. Query builders
 * can, and they cost nothing here: this list is a handful of static columns,
 * and the compiler now checks them against the schema.
 */
const WORKSTREAM_REFERRERS: ReadonlyArray<
  (db: CruxDb, oldId: string, newId: string) => BatchItem<"sqlite">
> = [
  (db, oldId, newId) =>
    db
      .update(observations)
      .set({ workstreamId: newId })
      .where(eq(observations.workstreamId, oldId)),
  (db, oldId, newId) =>
    db.update(problems).set({ workstreamId: newId }).where(eq(problems.workstreamId, oldId)),
];

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

  // Must lead the batch: the deferral applies to the transaction it opens in.
  const writes: BatchItem<"sqlite">[] = [db.run(sql`PRAGMA defer_foreign_keys = on`)];

  if (oldId !== newId) {
    for (const referrer of WORKSTREAM_REFERRERS) writes.push(referrer(db, oldId, newId));
  }

  const set: Partial<typeof workstreams.$inferInsert> = { updatedAt: now };
  if (oldId !== newId) {
    set.id = newId;
    set.slug = newSlug;
  }
  if (updates.title !== undefined) set.title = updates.title;
  if (updates.description !== undefined) set.description = updates.description;
  writes.push(db.update(workstreams).set(set).where(eq(workstreams.id, oldId)));

  await runBatch(db, writes);

  return { kind: "workstream", oldId, newId, oldSlug, newSlug };
}
