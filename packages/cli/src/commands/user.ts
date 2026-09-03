import { defineCommand } from "citty";
import { configPath, loadUserConfig, slugifyName, writeUserConfig } from "../config/user.js";
import { UserInitInput } from "../validation/index.js";
import { emit, setJsonMode } from "../output.js";

const initCmd = defineCommand({
  meta: {
    name: "init",
    // The users row is the deployment's, created when a Member is invited and a
    // token minted; the token is what identifies the actor on every request. All
    // this writes is the local half of that identity.
    description: "Write the local user config.",
  },
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
    // The `[user]` section only — `[api]` holds a bearer token, and this
    // command's output ends up pasted into conversations.
    emit(
      cfg ? { user: cfg.user } : { user: null },
      cfg ? `${cfg.user.id} (${cfg.user.name})` : "no user config",
    );
  },
});

export const userCommand = defineCommand({
  meta: { name: "user", description: "User identity / config." },
  subCommands: { init: initCmd, show: showCmd },
});
