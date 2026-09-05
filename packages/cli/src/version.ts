import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The client's version is the *release* version — the one `/release` bumps and
 * `/health` serves — and there is exactly one for the repository, because the
 * repository releases as a unit and the plugin ships that unit
 * ([ADR-0018](../../../docs/adr/0018-a-skew-is-a-refusal-not-a-bad-argument.md)).
 * So it is read from `apps/cloud/package.json` and never from
 * `packages/cli/package.json`, which has never been bumped off `0.0.0` and is
 * the drift that decision exists to stop happening twice.
 */
const RELEASE_MANIFEST = join("apps", "cloud", "package.json");

/**
 * Reported when no candidate root holds a readable manifest — a layout nothing
 * in this repository produces. It is deliberately not a version number: a
 * hardcoded fallback that looks like one is how a client starts lying about
 * what it is. Callers say so on stderr rather than passing it off as an answer.
 */
export const UNRESOLVED_VERSION = "unknown";

/**
 * Where the release manifest might be, in order:
 *
 * 1. `CRUX_PLUGIN_ROOT`, exported by `bin/crux` — the installed-plugin path,
 *    where the CLI may be invoked from anywhere on disk.
 * 2. The repository root relative to this module (`packages/cli/src/` → up
 *    three) — the source-checkout path, where `bun run crux` bypasses `bin/crux`
 *    and sets no environment.
 */
function candidateRoots(): string[] {
  const roots: string[] = [];
  const pluginRoot = process.env.CRUX_PLUGIN_ROOT;
  if (pluginRoot) roots.push(pluginRoot);
  roots.push(join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
  return roots;
}

/**
 * The version this client is, resolved locally and never over the network: a
 * version flag that fails when the deployment is unreachable fails exactly when
 * somebody most needs to know what they are running (ADR-0018).
 */
export function resolveCliVersion(): string {
  for (const root of candidateRoots()) {
    try {
      const raw = readFileSync(join(root, RELEASE_MANIFEST), "utf8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === "string" && version.length > 0) return version;
    } catch {
      // Not this root — try the next one.
    }
  }
  return UNRESOLVED_VERSION;
}

/**
 * The client's version, saying so on stderr when this install cannot name one.
 *
 * Both doors to the version — the `--version` flag and the `version` command —
 * go through here, so the one answer ADR-0018 asks for is one function rather
 * than two that agree by inspection. `UNRESOLVED_VERSION` still reaches the
 * caller: the question was answered, and exit 0 says so. But an install this
 * broken should not read as an ordinary answer, and stderr is where the CLI
 * already says the things a caller did not ask for.
 */
export function reportCliVersion(): string {
  const version = resolveCliVersion();
  if (version === UNRESOLVED_VERSION) {
    process.stderr.write("crux: cannot resolve the release version from this install.\n");
  }
  return version;
}
