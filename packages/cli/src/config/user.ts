import { homedir } from "node:os";
import { join } from "node:path";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
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

/** Owner-only, because the `[api]` token is a bearer credential. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/** Group and other. Nothing outside the owner may hold any bit here. */
const SHARED_BITS = 0o077;

/**
 * Take group and other off the config directory and file.
 *
 * `config.toml` holds the bearer token that owns everything a Principal has
 * ever filed (ADR-0013), and the deployment keeps only its hash — so a token
 * read out of this file is the corpus, and one lost with it is unrecoverable.
 * Umask decides nothing here: the modes are chosen, and an existing file left
 * looser by an older version is tightened rather than trusted, which is why
 * this runs on read as well as on write.
 *
 * It only ever narrows. A user who hardened their own config to 400 keeps it,
 * because the bits that matter are the ones outside the owner. It also refuses
 * to follow a symlink: `chmod` has no `l` variant on Linux, so a `config.toml`
 * placed by a dotfile manager would otherwise have its *target* — a file in
 * some repo that is none of our business — silently re-moded on every command.
 *
 * Best-effort by design: a filesystem that cannot express these modes must not
 * take the CLI down over it. Windows expresses only a read-only bit, so there
 * is nothing here to say and the syscalls are skipped outright.
 */
function tightenPermissions(): void {
  if (process.platform === "win32") return;
  try {
    narrow(configDir(), DIR_MODE);
    narrow(configPath(), FILE_MODE);
  } catch {
    // Nothing to say and nothing to do: the read or write it guards still works.
  }
}

function narrow(target: string, mode: number): void {
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if ((stat.mode & SHARED_BITS) === 0) return;
  chmodSync(target, stat.mode & mode);
}

/** The whole config file, or null when it does not exist yet. */
export function loadConfig(): Partial<UserConfig> | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  tightenPermissions();
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
  // No `mode` on the mkdir: `recursive` would apply it to every parent it
  // creates, and `~/.claude` is Claude Code's directory, not ours to re-mode.
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  tightenPermissions();
  const p = configPath();
  const merged = { ...loadConfig(), ...patch };
  // Written aside and renamed into place. A truncate-in-place that is
  // interrupted leaves a half-parsed TOML, and half a token is a corpus nobody
  // can prove they own. `mode` applies because the temp file is always created.
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, stringify(merged as unknown as Record<string, unknown>), {
    encoding: "utf8",
    mode: FILE_MODE,
  });
  renameSync(tmp, p);
  tightenPermissions();
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
