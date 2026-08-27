/**
 * Better Auth, configured for this deployment.
 *
 * The one interesting decision here is that Better Auth's `user` model is
 * pointed at the existing `users` table (see `db/auth-schema.ts`), so a browser
 * session and a CLI bearer token resolve to the same row. Everything else —
 * sessions, credential accounts, verifications — lives in tables Better Auth
 * owns outright, prefixed `auth_` so the corpus schema and the auth schema stay
 * legible as separate things in one database.
 *
 * Membership is not modelled. There is no Workspace table and no role column:
 * the deployment is the Workspace and a row in `users` is a Member (ADR-0003),
 * so "can this person see this Workstream" is not a question the code asks.
 *
 * Sign-in is a magic link and nothing else. `disableSignUp` is what makes that
 * safe to leave open to the internet: the endpoint mints a link only for an
 * address that already has a `users` row, so possession of an inbox is proof of
 * *identity*, never of *membership* — membership is the row, and only an invite
 * creates one. Passwords are gone rather than kept as a second door, because a
 * second door is a second way to be wrong about who someone is.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";

import type { CruxDb } from "../db/client.js";
import { authUsers, authSessions, authAccounts, authVerifications } from "../db/auth-schema.js";
import { magicLinkEmail, type EmailSender } from "./email.js";

/** Prefixed ids, matching the repo's `USR-` / `SES-` primary-key convention. */
const PREFIXES: Record<string, string> = {
  user: "USR",
  session: "SES",
  account: "ACC",
  verification: "VER",
};

function randomSuffix(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export type CruxAuth = ReturnType<typeof createAuth>;

/** How long a sign-in link stays good. Long enough to walk to another device,
 * short enough that a link sitting in an inbox is not a standing credential. */
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export type CreateAuthOptions = {
  secret: string;
  baseURL?: string;
  /** Delivers the sign-in link. Omitted only where nothing signs in — the
   * caller is expected to have refused the request before reaching here. */
  sendEmail?: EmailSender;
  /** Named in the subject line so the mail says which deployment it is for. */
  workspace?: string;
};

/**
 * Build the auth instance for a request's database and secret.
 *
 * `basePath` is `/api/auth`; every route under it belongs to Better Auth,
 * including `magic-link/verify` — the link in the mail lands there, so no route
 * in `router.ts` handles it and there is no second place to get it wrong.
 */
export function createAuth(db: CruxDb, opts: CreateAuthOptions) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    secret: opts.secret,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    basePath: "/api/auth",
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        // The membership gate. Without it, `sign-in/magic-link` would create a
        // `users` row for any address that asked, and anyone on the internet
        // could make themselves a Member of a deployment that sees every
        // Workstream in it.
        disableSignUp: true,
        // Same reasoning as the CLI tokens and the invite tokens: what lands in
        // the database is a hash, so a leaked corpus yields no usable links.
        storeToken: "hashed",
        sendMagicLink: async ({ email, url }) => {
          if (!opts.sendEmail) {
            throw new Error("this deployment has no email sender configured");
          }
          const message = magicLinkEmail({
            url,
            workspace: opts.workspace ?? "Crux",
            expiresInMinutes: MAGIC_LINK_TTL_SECONDS / 60,
          });
          await opts.sendEmail({ to: email, ...message });
        },
      }),
    ],
    user: {
      modelName: "user",
      fields: {
        emailVerified: "emailVerified",
        createdAt: "createdAt",
        updatedAt: "updatedAt",
      },
      additionalFields: {
        // `users.slug` is NOT NULL and predates Better Auth, so sign-up has to
        // supply it. It is the human-readable half of the attribution the CLI
        // already prints.
        slug: { type: "string", required: true, input: true },
      },
    },
    session: { modelName: "session" },
    account: { modelName: "account" },
    verification: { modelName: "verification" },
    advanced: {
      database: { generateId: ({ model }) => `${PREFIXES[model] ?? "ID"}-${randomSuffix()}` },
    },
  });
}
