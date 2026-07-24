import { defineConfig } from "drizzle-kit";

/**
 * D1 migration chain. A D1 database starts empty, so it is baselined from the
 * current schema rather than replaying the single-machine libSQL history in
 * ./packages/core/src/db/migrations (which uses `PRAGMA foreign_keys` and temp
 * tables — both rejected by D1's authorizer). Same schema.ts, both chains.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/core/src/db/schema.ts",
  out: "./packages/core/src/db/migrations-d1",
  strict: true,
  verbose: true,
});
