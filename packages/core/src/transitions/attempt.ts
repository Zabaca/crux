import { and, eq } from "drizzle-orm";
import type { CruxDb } from "../db/client.js";
import { attempts } from "../db/schema.js";
import { InvariantError, NotFoundError, TransitionError } from "./errors.js";

/** The two ways an Attempt stops being open (ADR-0012). */
export const ATTEMPT_CLOSED_STATUSES = ["shipped", "dropped"] as const;
export type AttemptClosedStatus = (typeof ATTEMPT_CLOSED_STATUSES)[number];

/**
 * File an Attempt against a Problem: a pointer to work happening elsewhere.
 *
 * `ref` and `label` are both required and both non-empty — an Attempt with
 * neither a destination nor a name is a row that answers nothing. There is no
 * description parameter, deliberately; see the table comment in `db/schema.ts`.
 */
export async function createAttempt(
  input: { id: string; problemId: number; ref: string; label: string; createdById: string },
  db: CruxDb,
): Promise<string> {
  const ref = input.ref.trim();
  const label = input.label.trim();
  if (!ref) throw new InvariantError("Attempt requires a ref", { id: input.id });
  if (!label) throw new InvariantError("Attempt requires a label", { id: input.id });

  await db.insert(attempts).values({
    id: input.id,
    problemId: input.problemId,
    ref,
    label,
    createdById: input.createdById,
  });
  return input.id;
}

/**
 * Close an Attempt as `shipped` or `dropped`, with the judgment that made it
 * end that way.
 *
 * The closing note is required, because it is the only thing here the linked
 * tracker does not already hold. Closing is one-way: a closed Attempt cannot be
 * closed again, and nothing here touches the Problem — something shipping is a
 * fact about the world, and the Problem being gone is a judgment somebody makes
 * (ADR-0012).
 */
export async function closeAttempt(
  input: { id: string; status: AttemptClosedStatus; closingNote: string },
  db: CruxDb,
): Promise<void> {
  const rows = await db.select().from(attempts).where(eq(attempts.id, input.id)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Attempt not found: ${input.id}`, { id: input.id });
  if (row.status !== "open") {
    throw new TransitionError(
      `Attempt ${input.id} is already ${row.status}; only an open Attempt can be closed`,
      { id: input.id, from: row.status, to: input.status },
    );
  }
  const closingNote = input.closingNote.trim();
  if (!closingNote) {
    throw new InvariantError("Closing an Attempt requires a closing note", { id: input.id });
  }

  // Scoped to `status = 'open'` as well as the id, because the check above is
  // a read: two closes racing each other both pass it, and only one of them
  // should get to write a closing note over the other's. `RETURNING` is how the
  // loser finds out — without it, it would report the close it did not make.
  const written = await db
    .update(attempts)
    .set({ status: input.status, closingNote, updatedAt: Date.now() })
    .where(and(eq(attempts.id, input.id), eq(attempts.status, "open")))
    .returning({ id: attempts.id });
  if (written.length === 0) {
    throw new TransitionError(`Attempt ${input.id} was closed by someone else first`, {
      id: input.id,
      to: input.status,
    });
  }
}
