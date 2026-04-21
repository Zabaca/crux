import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "smol-toml";

export interface UserConfig {
  user: {
    id: string; // USR-<slug>
    slug: string;
    name: string;
    email?: string;
  };
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "crux");
}

export function configPath(): string {
  return join(configDir(), "config.toml");
}

export function loadUserConfig(): UserConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return parse(raw) as unknown as UserConfig;
}

export function writeUserConfig(cfg: UserConfig): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = configPath();
  writeFileSync(p, stringify(cfg as unknown as Record<string, unknown>), "utf8");
  return p;
}

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function requireUser(): UserConfig {
  const cfg = loadUserConfig();
  if (!cfg) {
    throw new Error(
      `No user config found at ${configPath()}. Run: crux user init --name "Your Name" --email "you@example.com"`,
    );
  }
  return cfg;
}
