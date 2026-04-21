import { defineConfig } from "drizzle-kit";

const url = process.env.CRUX_DB_URL ?? "file:.crux.db";

export default defineConfig({
  dialect: "turso",
  schema: "./packages/core/src/db/schema.ts",
  out: "./packages/core/src/db/migrations",
  dbCredentials: {
    url,
  },
  strict: true,
  verbose: true,
});
