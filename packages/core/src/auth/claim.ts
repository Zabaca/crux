/**
 * Claiming an existing `users` row.
 *
 * Better Auth's `signUpEmail` always creates a user. That is wrong for a
 * deployment whose corpus arrived before its accounts did: the rows migrated
 * from the single-machine database are authored by `users` rows that nobody can
 * sign in as, and signing up with the same address would either collide on the
 * unique email index or mint a second identity for one person, stranding their
 * authorship on the first.
 *
 * So redeeming an invite claims the existing row when there is one, and creates
 * a user only when there is not. `authUsers` is a view of the same physical
 * `users` table (see `db/auth-schema.ts`), so the credential attaches directly
 * to the id already stamped on every Observation, Problem and Decision that
 * person filed.
 *
 * A row is claimable only while it has no credential. Once claimed it is an
 * ordinary account, and a second attempt is refused rather than silently
 * resetting the password — this runs behind an emailed invite link, not behind
 * a session, so treating it as a password-reset path would make an invite a
 * way to take over an existing Member.
 */
import type { CruxAuth } from "./better-auth.js";

export type ClaimOutcome =
  | { claimed: true; userId: string }
  | { claimed: false; reason: "no-such-user" | "already-has-credentials" };

/**
 * Attach a password credential to the `users` row with this email, if that row
 * exists and has none yet. Returns the claimed user id, or why it declined.
 */
export async function claimUserByEmail(
  auth: CruxAuth,
  opts: { email: string; password: string },
): Promise<ClaimOutcome> {
  const ctx = await auth.$context;

  const found = await ctx.internalAdapter.findUserByEmail(opts.email);
  const userId = found?.user?.id;
  if (!userId) return { claimed: false, reason: "no-such-user" };

  // Ask the account table directly: `findUserByEmail` does not reliably
  // populate `accounts`, and "has any credential" is the whole guard here.
  const accounts = await ctx.internalAdapter.findAccountByUserId(userId);
  if (accounts.length > 0) return { claimed: false, reason: "already-has-credentials" };

  const password = await ctx.password.hash(opts.password);
  await ctx.internalAdapter.linkAccount({
    userId,
    providerId: "credential",
    accountId: userId,
    password,
  });

  return { claimed: true, userId };
}
