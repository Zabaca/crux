/**
 * Making someone a Member.
 *
 * Membership is a row in `users` and nothing else (ADR-0003, ADR-0007), so this
 * module is the whole of "join": ensure the row exists, and let the magic link
 * do the rest. There is no credential to attach — that is what changed when
 * passwords went away. Sign-in mints a link only for an address that already
 * has a row (`disableSignUp` in `better-auth.ts`), which is precisely why
 * creating the row *is* granting access, and why only an invite may do it.
 *
 * The row may already exist. A corpus migrated from the single-machine database
 * authors its rows against `users` rows nobody has ever signed in as, and those
 * rows carry the authorship stamped on every Observation, Problem and Outcome
 * that person filed. Re-using one is the point: minting a second identity for
 * the same address would strand their history on the first.
 *
 * Both outcomes are deliberately treated the same by the caller — redeeming an
 * invite ends at "check your email" whether the row was created or found. An
 * invite that turns out to be redundant is not an error; it is a Member being
 * told, correctly, how to sign in.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import type { CruxDb } from "../db/client.js";
import { authUsers } from "../db/auth-schema.js";
import { normalizeEmail, slugFromEmail } from "./invites.js";

export type Member = { id: string; name: string; email: string | null };

export type MemberOutcome = {
  userId: string;
  /** False when the address already had a row — a re-invite, not a new Member. */
  created: boolean;
};

/**
 * Everyone currently in the Workspace. A removed row is not a Member.
 *
 * Nor is an unclaimed Principal. Since ADR-0013 a `users` row is minted by first
 * use as well as by an invite, and the anonymous ones have no email — nobody to
 * mail a sign-in link to, nobody to name on a Members page, and nothing an
 * operator could do about one. An address is what makes a row a *person* here,
 * so that is the predicate.
 */
export async function listMembers(db: CruxDb): Promise<Member[]> {
  return db
    .select({ id: authUsers.id, name: authUsers.name, email: authUsers.email })
    .from(authUsers)
    .where(and(isNull(authUsers.removedAt), isNotNull(authUsers.email)));
}

/**
 * Remove `userId` from the Workspace.
 *
 * The row is stamped, never deleted: `users.id` is the target of a foreign key
 * from every authored table, and attribution is the product (ADR-0007), so a
 * delete would either be refused or would strand the history the row carries.
 * Nothing else is written — no token is revoked and no session row is dropped
 * — because every gate reads this one column: `findMemberByEmail` stops the
 * mail, `authenticateToken` stops the CLI, and the browser's viewer lookup
 * stops the session. One write to undo, which is what makes a re-invite a
 * reinstatement rather than a rebuild.
 *
 * Returns false when `userId` names nobody, or names someone already removed —
 * a second removal is not an error to the caller, it is a no-op that already
 * happened.
 */
export async function removeMember(
  db: CruxDb,
  opts: { userId: string; now?: number },
): Promise<boolean> {
  const result = await db
    .update(authUsers)
    .set({ removedAt: opts.now ?? Date.now() })
    .where(and(eq(authUsers.id, opts.userId), isNull(authUsers.removedAt)));
  const meta = (result as { meta?: { changes?: number } } | undefined)?.meta;
  return (meta?.changes ?? 0) > 0;
}

/**
 * Is `userId` still a Member? The gate every session-bearing request passes.
 *
 * A browser session outlives the removal that ended the membership, and so does
 * a sign-in link already sitting in an inbox — Better Auth will happily verify
 * one, since the row it names still exists. Checking the row here is what makes
 * both worthless the moment the stamp lands.
 */
export async function isActiveMember(db: CruxDb, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(and(eq(authUsers.id, userId), isNull(authUsers.removedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The `users` row for `email`, or null.
 *
 * This is the send-time membership gate. The magic-link plugin's own
 * `disableSignUp` is checked when a link is *verified*, not when one is sent,
 * so relying on it alone would mail a sign-in link to any address that asked
 * and refuse it only after the click — an open relay pointed at the
 * deployment's sending reputation, and a worse experience for the one person it
 * was actually a typo for. Asking here means the mail is never sent at all.
 */
export async function findMemberByEmail(db: CruxDb, email: string): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(and(eq(authUsers.email, normalizeEmail(email)), isNull(authUsers.removedAt)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Ensure a `users` row exists for `email`, creating one named `name` if not.
 *
 * `slug` is derived from the address and made unique here rather than by the
 * caller, because it is NOT NULL and a collision is a runtime failure at the
 * least convenient moment — the one time a new Member ever touches this path.
 *
 * This looks past a removal, unlike `findMemberByEmail`. The gates want to know
 * whether someone is a Member *now*; joining wants to know whether this address
 * has ever had a row, because re-using one is the whole point — a removed
 * Member's entries still cite their id, and minting a second identity for the
 * same address would strand every one of them. So an invite to a removed
 * address is a reinstatement: the stamp is cleared and everything they had
 * comes back, tokens included.
 */
export async function ensureMember(
  db: CruxDb,
  opts: { email: string; name: string; now?: number },
): Promise<MemberOutcome> {
  const email = normalizeEmail(opts.email);

  const existing = await db
    .select({ id: authUsers.id, removedAt: authUsers.removedAt })
    .from(authUsers)
    .where(eq(authUsers.email, email))
    .limit(1);
  const found = existing[0];
  if (found) {
    if (found.removedAt !== null) {
      await db.update(authUsers).set({ removedAt: null }).where(eq(authUsers.id, found.id));
    }
    return { userId: found.id, created: false };
  }

  const now = opts.now ?? Date.now();
  const userId = `USR-${randomSuffix()}`;
  await db.insert(authUsers).values({
    id: userId,
    name: opts.name,
    email,
    slug: await uniqueSlug(db, slugFromEmail(email)),
    // The address is proven by the invite mail that carried the token here, and
    // proven again by the sign-in link that follows. Leaving this false would
    // make it permanently false: nothing else in the deployment ever sets it.
    emailVerified: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });

  return { userId, created: true };
}

/** `users.slug` is unique; add a suffix until it is. */
async function uniqueSlug(db: CruxDb, base: string): Promise<string> {
  const rows = await db.select({ slug: authUsers.slug }).from(authUsers);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function randomSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
