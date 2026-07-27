import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "smol-toml";

export interface ApiConfig {
  /** Base URL of the crux deployment, e.g. https://crux.example.workers.dev */
  url: string;
  /** Bearer token minted for this user by the deployment. */
  token: string;
}

export interface UserConfig {
  user: {
    id: string; // USR-<slug>
    slug: string;
    name: string;
    email?: string;
  };
  /** Where the corpus lives. Absent until `crux init` has pointed the CLI at it. */
  api?: ApiConfig;
}

export function resolveCruxHome(): string {
  if (process.env.CRUX_HOME) return process.env.CRUX_HOME;
  return join(homedir(), ".claude", ".crux");
}

export function configDir(): string {
  return resolveCruxHome();
}

export function configPath(): string {
  return join(configDir(), "config.toml");
}

/** The whole config file, or null when it does not exist yet. */
export function loadConfig(): Partial<UserConfig> | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return parse(raw) as unknown as Partial<UserConfig>;
}

export function loadUserConfig(): UserConfig | null {
  const cfg = loadConfig();
  return cfg?.user ? (cfg as UserConfig) : null;
}

/**
 * Merge a patch over the config file, section by section. Sections are
 * independent — `crux init` writes `[api]` and `crux user init` writes `[user]`
 * — so a whole-file overwrite would silently drop whichever one it didn't set.
 */
export function writeConfig(patch: Partial<UserConfig>): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = configPath();
  const merged = { ...loadConfig(), ...patch };
  writeFileSync(p, stringify(merged as unknown as Record<string, unknown>), "utf8");
  return p;
}

export function writeUserConfig(cfg: UserConfig): string {
  return writeConfig(cfg);
}

/**
 * The API coordinates as far as they are known. Returned partial rather than
 * all-or-nothing so a caller can say *which* half is missing; env vars win over
 * the file so a shell can point one invocation at another deployment.
 */
export function loadApiConfig(): Partial<ApiConfig> {
  const cfg = loadConfig();
  return {
    url: process.env.CRUX_API_URL ?? cfg?.api?.url,
    token: process.env.CRUX_API_TOKEN ?? cfg?.api?.token,
  };
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
