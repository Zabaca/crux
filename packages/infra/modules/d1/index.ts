import { z } from "zod";
import { defineModule } from "../../src/define-module";

/**
 * d1 — finds (or creates) a Cloudflare D1 database and applies its schema, over
 * the REST API.
 *
 * Why schema application lives in an infra module rather than a shell step:
 * foothill-metabolic's turso instance applies its drizzle migrations inside
 * `apply()` (`migrationsDir`), so `zbc apply` alone converges both the database
 * and the code. cedarpad had to put its D1 migrations in a wrapper script
 * instead — zbc's cloudflare module has no post-deploy hook and there is no D1
 * module upstream — and its own deploy.sh documents the resulting gap: a bare
 * `zbc apply` bypasses migrations entirely. Doing it here closes that gap.
 *
 * Ordering matters and is not incidental. A Worker instance that `imports` this
 * one deploys *after* it, so the schema is always at least as new as the code
 * reading it. cedarpad learned this the hard way (incident 2026-07-15): edge
 * code shipped ahead of an ALTER and 500s until the column landed.
 *
 * Statements are expected to be idempotent — crux defines its cloud database by
 * end state (`CREATE TABLE IF NOT EXISTS`) rather than by replaying a migration
 * history, so there is no ledger to keep and re-applying is a no-op. See
 * ADR-0006.
 *
 * Token scope: CLOUDFLARE_API_TOKEN needs Account → D1: Edit.
 */

const API = "https://api.cloudflare.com/client/v4";

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
}

async function cfFetch<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? "GET";
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  let envelope: CfEnvelope<T>;
  try {
    envelope = (await res.json()) as CfEnvelope<T>;
  } catch {
    throw new Error(`Cloudflare API ${path}: HTTP ${res.status} (non-JSON body)`);
  }
  if (!res.ok || !envelope.success) {
    const codes = (envelope.errors ?? []).map((e) => e.code);
    const detail = (envelope.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
    if (codes.includes(10000)) {
      throw new Error(
        `Cloudflare API ${path} rejected the token (10000 Authentication error). ` +
          `CLOUDFLARE_API_TOKEN is likely missing the Account → D1: Edit scope.`,
      );
    }
    throw new Error(`Cloudflare API ${path} failed (HTTP ${res.status}): ${detail}`);
  }
  return envelope.result;
}

/** One statement per call: D1's query endpoint is not a migration runner. */
async function exec(
  token: string,
  accountId: string,
  databaseId: string,
  sql: string,
): Promise<void> {
  await cfFetch(token, `/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    body: { sql },
  });
}

function isDuplicateColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate column name/i.test(message);
}

export const d1Module = defineModule({
  name: "d1",
  configSchema: z.object({
    /** Cloudflare account id (not a secret — it's in the dashboard URL). */
    accountId: z.string(),
    /** Database name — account-scoped, so namespace it per project and env. */
    databaseName: z.string(),
    /**
     * Idempotent DDL, applied in order. Every `references` target must be
     * created before its dependents; a failure here aborts the apply, and
     * therefore the deploy of anything importing this instance.
     */
    statements: z.array(z.string()).default([]),
    /**
     * Additive statements — `ALTER TABLE … ADD COLUMN`, plus any backfill that
     * must follow one. SQLite has no `IF NOT EXISTS` for columns, so these run
     * one at a time and a "duplicate column name" is the success case on every
     * run after the first. Anything else here must be idempotent: it runs on
     * every apply.
     */
    additiveColumns: z.array(z.string()).default([]),
  }),
  outputs: z.object({
    databaseName: z.string(),
    databaseId: z.string(),
  }),
  async apply(config, ctx) {
    const apiToken = ctx.secrets["CLOUDFLARE_API_TOKEN"];
    if (!apiToken) throw new Error("Missing secret: CLOUDFLARE_API_TOKEN");
    const base = `/accounts/${config.accountId}/d1/database`;

    const listing = await cfFetch<Array<{ name: string; uuid: string }>>(
      apiToken,
      `${base}?per_page=1000`,
    );
    let db = listing.find((d) => d.name === config.databaseName);
    if (db) {
      console.log(`  D1 database "${config.databaseName}" already exists (${db.uuid})`);
    } else {
      db = await cfFetch<{ name: string; uuid: string }>(apiToken, base, {
        method: "POST",
        body: { name: config.databaseName },
      });
      console.log(`  Created D1 database "${config.databaseName}" (${db.uuid})`);
    }

    if (config.statements.length > 0) {
      for (const sql of config.statements) {
        await exec(apiToken, config.accountId, db.uuid, sql);
      }
      console.log(`  Applied ${config.statements.length} schema statements`);
    }

    let ran = 0;
    let alreadyPresent = 0;
    for (const sql of config.additiveColumns) {
      try {
        await exec(apiToken, config.accountId, db.uuid, sql);
        ran += 1;
      } catch (err) {
        if (!isDuplicateColumn(err)) throw err;
        alreadyPresent += 1;
      }
    }
    if (config.additiveColumns.length > 0) {
      console.log(`  Additive: ${ran} ran, ${alreadyPresent} already present`);
    }

    return { databaseName: config.databaseName, databaseId: db.uuid };
  },
  // No destroy: the corpus is the product. Deleting it must be a deliberate
  // act with a human behind it, never a side effect of `zbc destroy`.
});
