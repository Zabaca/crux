/**
 * The tables Better Auth owns, plus a Better-Auth-shaped view of `users`.
 *
 * Two things are going on here, and both are deliberate.
 *
 * **One identity table.** Better Auth's `user` model is pointed at the existing
 * `users` table rather than given one of its own, so a browser session and a CLI
 * bearer token resolve to the same row. The alternative — a second user table
 * joined to ours — would make "who did this" a question with two answers, which
 * is exactly the ambiguity attribution rules exist to prevent.
 *
 * **`authUsers` is a second drizzle view of one physical table.** Better Auth
 * models its timestamps as `Date`; the corpus models every timestamp as epoch
 * milliseconds and `reads/` is built on that. Rather than convert the corpus,
 * this module re-declares `users` with `mode: "timestamp_ms"` on the columns
 * Better Auth touches. Same table, same rows, two typed lenses — the adapter
 * gets Dates, `db/schema.ts` keeps numbers, and neither has to know about the
 * other. Columns must stay in step with `users` in `./schema.ts`.
 */
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** `users`, typed the way Better Auth's drizzle adapter expects to see it. */
export const authUsers = sqliteTable("users", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  /** Kept as epoch ms rather than a Date: Better Auth never reads this column,
   * and every gate that does is corpus code. See `auth/membership.ts`. */
  removedAt: integer("removed_at"),
  /** The human this Principal was claimed by, and when — see `users` in
   * `./schema.ts`, whose declaration these two must stay in step with. Better
   * Auth never reads either; they are here so a claim can be written through
   * this lens in one statement, alongside the `email_verified` only this lens
   * has. */
  claimedByUserId: text("claimed_by_user_id"),
  claimedAt: integer("claimed_at"),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const authAccounts = sqliteTable("auth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => authUsers.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const authVerifications = sqliteTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * A pending invitation to the Workspace.
 *
 * This is the whole of membership. There is no Workspace table and no
 * membership table: the deployment *is* the Workspace (ADR-0003), so a row in
 * `users` is a Member, and an invite is the one-time permission to create one.
 * `accepted_at` makes an invite single-use without deleting the record of who
 * invited whom.
 */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(), // INV-<random>
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedById: text("invited_by_id")
      .notNull()
      .references(() => authUsers.id),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    acceptedUserId: text("accepted_user_id").references(() => authUsers.id),
  },
  (t) => ({ tokenHashUnique: uniqueIndex("invites_token_hash_unique").on(t.tokenHash) }),
);

/**
 * A pending claim: an address someone asked to attach to a Principal
 * (ADR-0013), not yet proved.
 *
 * It sits beside `invites` because it is the same shape of thing — a hashed,
 * expiring, single-use token mailed to an address — and deliberately *not* the
 * same table, because it grants something different. An invite creates a
 * Member; a claim attaches an existing Principal to a human and widens what
 * that human can read.
 *
 * The row is what makes "prove the address before writing the edge" possible.
 * Writing `users.claimed_by_user_id` when the claim is *requested* would let
 * anyone type a stranger's address and be linked to them the moment that
 * stranger claimed anything of their own — a cross-tenant disclosure through a
 * form field. So the request records intent, and only the click applies it.
 */
export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(), // CLM-<random>
    /** The Principal being claimed. */
    principalId: text("principal_id")
      .notNull()
      .references(() => authUsers.id),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at").notNull(),
    /** Spent, not deleted — so a second click is refused rather than replayed. */
    claimedAt: integer("claimed_at"),
  },
  (t) => ({ tokenHashUnique: uniqueIndex("claims_token_hash_unique").on(t.tokenHash) }),
);
