import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

// Mirror resolveDbUrl() in packages/core/src/db/client.ts.
const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const url = process.env.CRUX_DB_URL ?? `file:${join(dataHome, "crux", "crux.db")}`;

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
