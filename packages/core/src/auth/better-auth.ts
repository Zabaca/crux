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
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import type { CruxDb } from "../db/client.js";
import { authUsers, authSessions, authAccounts, authVerifications } from "../db/auth-schema.js";

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

/**
 * Build the auth instance for a request's database and secret.
 *
 * `basePath` is `/api/auth`; every route under it belongs to Better Auth.
 */
export function createAuth(db: CruxDb, opts: { secret: string; baseURL?: string }) {
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
    emailAndPassword: {
      enabled: true,
      // Nobody signs themselves up: an account is created only by redeeming an
      // invite, which is checked before this is ever called.
      autoSignIn: true,
      minPasswordLength: 10,
    },
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
