import { defineCommand } from "citty";
import { getDb } from "@crux/core";
import { users } from "@crux/core/db/schema";
import { configPath, loadUserConfig, slugifyName, writeUserConfig } from "@crux/core/config";
import { UserInitInput } from "@crux/core/validation";
import { eq } from "drizzle-orm";
import { emit, setJsonMode } from "../output.js";

const initCmd = defineCommand({
  meta: { name: "init", description: "Create/update the local user config and User row." },
  args: {
    name: { type: "string", required: true, description: "Display name" },
    email: { type: "string", description: "Email address" },
    json: { type: "boolean", description: "Emit JSON" },
  },
  async run({ args }) {
    if (args.json) setJsonMode(true);
    const parsed = UserInitInput.parse({ name: args.name, email: args.email });
    const slug = slugifyName(parsed.name);
    const id = `USR-${slug}`;
    writeUserConfig({ user: { id, slug, name: parsed.name, email: parsed.email } });
    const db = getDb();
    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (existing.length === 0) {
      await db.insert(users).values({ id, slug, name: parsed.name, email: parsed.email });
    } else {
      await db
        .update(users)
        .set({ name: parsed.name, email: parsed.email })
        .where(eq(users.id, id));
    }
    emit(
      {
        ok: true,
        user: { id, slug, name: parsed.name, email: parsed.email },
        configPath: configPath(),
      },
      `user ${id} written to ${configPath()}`,
    );
  },
});

const showCmd = defineCommand({
  meta: { name: "show", description: "Show the local user config." },
  args: { json: { type: "boolean" } },
  run({ args }) {
    if (args.json) setJsonMode(true);
    const cfg = loadUserConfig();
    emit(cfg ?? { user: null }, cfg ? `${cfg.user.id} (${cfg.user.name})` : "no user config");
  },
});

export const userCommand = defineCommand({
  meta: { name: "user", description: "User identity / config." },
  subCommands: { init: initCmd, show: showCmd },
});
