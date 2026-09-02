#!/usr/bin/env bun
/**
 * Rebuild the deployment's D1 database empty, and put one identity back.
 *
 * Destructive and human-gated on purpose: every command is a dry run unless it
 * is given `--confirm <database name>`, and the dry run happens before the API
 * token is even read, so it needs no credentials. The procedure this belongs to
 * — where that token comes from, and the deploy that has to follow a wipe — is
 * `docs/runbooks/rebuild-production-database.md`.
 *
 *   bun run db:wipe
 *   bun run db:wipe --confirm crux-production
 *   bun run db:restore-identity --email you@example.com --name "Your Name" \
 *     --confirm crux-production
 *
 * Account and database come from the production d1 instance rather than being
 * retyped here, so this cannot be pointed at a stale database by drift.
 */
import d1Instance from "../packages/infra/environments/production/d1";
import { dropAll, listSchemaObjects, type SqlRunner } from "../packages/core/src/db/d1/rebuild";
import { normalizeEmail, slugFromEmail } from "../packages/core/src/auth/invites";

// `ModuleInstance.config` is typed `unknown`, and scripts/ is in no tsconfig
// project, so nothing would catch a rename in d1.ts until the wipe ran against
// production. Read it defensively instead.
const { accountId, databaseName } = readD1Config(d1Instance.config);

function readD1Config(config: unknown): { accountId: string; databaseName: string } {
  const { accountId, databaseName } = (config ?? {}) as Record<string, unknown>;
  if (typeof accountId !== "string" || typeof databaseName !== "string") {
    throw new Error(
      "packages/infra/environments/production/d1.ts no longer exposes accountId + databaseName",
    );
  }
  return { accountId, databaseName };
}

const API = "https://api.cloudflare.com/client/v4";

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

async function cf<T>(token: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let envelope: CfEnvelope<T>;
  try {
    envelope = (await res.json()) as CfEnvelope<T>;
  } catch {
    throw new Error(`Cloudflare API ${path}: HTTP ${res.status} (non-JSON body)`);
  }
  if (!res.ok || !envelope.success) {
    const detail = (envelope.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    throw new Error(`Cloudflare API ${path} failed (HTTP ${res.status}): ${detail}`);
  }
  return envelope.result;
}

/** The D1 query endpoint, shaped as the runner `dropAll` wants. */
function d1Runner(token: string, databaseId: string): SqlRunner {
  const query = async (sql: string) =>
    cf<Array<{ results?: Array<Record<string, unknown>> }>>(
      token,
      `/accounts/${accountId}/d1/database/${databaseId}/query`,
      { sql },
    );
  return {
    exec: async (sql) => {
      await query(sql);
    },
    all: async (sql) => (await query(sql))[0]?.results ?? [],
  };
}

async function databaseIdFor(token: string): Promise<string> {
  const listing = await cf<Array<{ name: string; uuid: string }>>(
    token,
    `/accounts/${accountId}/d1/database?per_page=1000`,
  );
  const found = listing.find((d) => d.name === databaseName);
  if (!found) throw new Error(`No D1 database named "${databaseName}" in account ${accountId}`);
  return found.uuid;
}

function requireToken(): string {
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  if (!token) {
    fail(
      "CLOUDFLARE_API_TOKEN is not set. It lives in packages/infra/environments/production/secrets.yaml:\n" +
        "  export CLOUDFLARE_API_TOKEN=$(sops -d packages/infra/environments/production/secrets.yaml | grep '^CLOUDFLARE_API_TOKEN:' | cut -d' ' -f2)",
    );
  }
  return token;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  // Without this, `--name --confirm crux-production` names the Member
  // "--confirm" while the gate independently finds its value and lets it
  // through. A missing value is a typo, and typos here are expensive.
  if (value === undefined || value.startsWith("--")) fail(`--${name} needs a value`);
  return value;
}

/**
 * The gate. It is deliberately the database's own name rather than `--yes`:
 * typing "crux-production" is a sentence about what is about to be destroyed,
 * and it is checked before the token is even read, so a dry run needs no
 * credentials at all.
 */
function confirmed(argv: string[]): boolean {
  const value = flag(argv, "confirm");
  if (value === undefined) return false;
  if (value !== databaseName) {
    fail(`--confirm must be exactly "${databaseName}" (got "${value}")`);
  }
  return true;
}

async function wipe(argv: string[]): Promise<void> {
  const go = confirmed(argv);
  if (!go) {
    console.error(
      `Dry run: this would DROP every table in D1 database "${databaseName}" ` +
        `(account ${accountId}), discarding the corpus permanently.\n` +
        `Nothing has been contacted. To actually do it:\n\n` +
        `  bun run db:wipe --confirm ${databaseName}\n\n` +
        `Then run \`bun run deploy\` — it reapplies the schema and redeploys the Worker.\n` +
        `See docs/runbooks/rebuild-production-database.md.`,
    );
    process.exit(2);
  }

  const token = requireToken();
  const databaseId = await databaseIdFor(token);
  const runner = d1Runner(token, databaseId);

  const before = await listSchemaObjects(runner);
  console.log(`${databaseName} (${databaseId}) holds ${before.length} schema objects.`);
  const dropped = await dropAll(runner);
  console.log(`Dropped ${dropped.length}: ${dropped.join(", ")}`);

  const after = await listSchemaObjects(runner);
  if (after.length > 0) {
    fail(
      `${after.length} objects survived: ${after.map((o) => o.name).join(", ")}\n` +
        `The wipe is idempotent — re-run the same command to finish it.`,
    );
  }
  console.log(
    `\n"${databaseName}" is empty. Run \`bun run deploy\` to reapply the schema and ` +
      `redeploy the Worker, then restore an identity.`,
  );
}

/**
 * Put one `users` row back, so the browser is reachable again.
 *
 * Signing in mails a link only to an address that already has a row, and rows
 * are created by redeeming an invite, which only a Member can issue — so an
 * empty database has no way in that does not start here. The row written is
 * the one `ensureMember` writes: a verified address, a slug made unique
 * against the table, and no removal stamp. Everything after that — inviting
 * others, minting a CLI token — happens in the browser. Superseded once
 * Principals land (ADR-0013).
 *
 * The address is looked up first, for the same reason `ensureMember` does it:
 * an existing row must be reused rather than shadowed, since everything that
 * person authored cites its id. This command only reports that case — clearing
 * a removal stamp is what an invite is for.
 */
async function restoreIdentity(argv: string[]): Promise<void> {
  const raw = flag(argv, "email");
  const email = raw === undefined ? undefined : normalizeEmail(raw);
  const name = flag(argv, "name");
  if (!email || !name) {
    fail(
      "usage: bun run db:restore-identity --email <address> --name <display name> " +
        `--confirm ${databaseName}`,
    );
  }

  const go = confirmed(argv);
  if (!go) {
    console.error(
      `Dry run: this would insert a users row for ${name} <${email}> into ` +
        `"${databaseName}" (its id and slug are chosen against the live table at ` +
        `write time).\nRe-run with --confirm ${databaseName}.`,
    );
    process.exit(2);
  }

  const token = requireToken();
  const databaseId = await databaseIdFor(token);
  const runner = d1Runner(token, databaseId);

  const existing = await runner.all(
    `SELECT id, removed_at FROM users WHERE email = '${escapeSql(email)}'`,
  );
  const found = existing[0];
  if (found) {
    fail(
      `${email} already has a users row (${String(found["id"])}` +
        `${found["removed_at"] === null ? "" : ", removed"}). ` +
        `Nothing was written — sign in as that address, or invite it from the browser ` +
        `to lift a removal.`,
    );
  }

  const taken = new Set(
    (await runner.all("SELECT slug FROM users")).map((row) => String(row["slug"])),
  );
  const slug = uniqueSlug(slugFromEmail(email), taken);
  const id = `USR-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const now = Date.now();
  await cf(token, `/accounts/${accountId}/d1/database/${databaseId}/query`, {
    sql:
      "INSERT INTO users (id, slug, name, email, created_at, email_verified, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 1, ?)",
    params: [id, slug, name, email, now, now],
  });
  console.log(
    `Restored ${id} — ${name} <${email}>, slug "${slug}".\n` +
      `Sign in at the deployment with that address; the link is mailed by Resend.`,
  );
}

/** Same rule as core's `uniqueSlug`: suffix until the table has no such slug. */
function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

/** The one read that interpolates: `all()` takes no bindings, and this is an
 * already-normalized email (lowercased, trimmed) going into a quoted literal. */
function escapeSql(value: string): string {
  return value.replaceAll("'", "''");
}

const [command, ...argv] = process.argv.slice(2);
try {
  if (command === "wipe") await wipe(argv);
  else if (command === "restore-identity") await restoreIdentity(argv);
  else {
    console.error(
      "usage: bun run db:wipe | bun run db:restore-identity [flags]\n" +
        "See docs/runbooks/rebuild-production-database.md.",
    );
    process.exit(1);
  }
} catch (error) {
  // A wipe that dies mid-way leaves a half-dropped database. Say so here rather
  // than leaving the operator to work out from a stack trace whether re-running
  // is safe (it is: every drop is `IF EXISTS` and the object list is re-read).
  fail(
    `${error instanceof Error ? error.message : String(error)}` +
      (command === "wipe"
        ? "\nThe wipe is idempotent — re-run the same command to finish it."
        : ""),
  );
}
