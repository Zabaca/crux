#!/usr/bin/env bun
/**
 * Copies the release version into the plugin manifests (ADR-0018).
 *
 * `apps/cloud/package.json` stays the single source — it is the only package
 * that becomes the deployment, and the only one about which a version claim can
 * be made (ADR-0015). The two `.claude-plugin` manifests are copies, because
 * Claude Code caches an installed plugin under its marketplace `version` string
 * and never moves off it while that string holds: a manifest left behind is an
 * installed client that never updates while production moves under it.
 *
 * Run by `/release` between the version bump and the release commit, so there
 * is no second place for a human to remember. Idempotent: run again and it says
 * both manifests already agree.
 *
 * `--check` writes nothing and exits non-zero when they disagree. That is the
 * copy's structural guard — `bun run verify` runs it, so a version moved by
 * hand is caught by the same gate every pull request already passes, rather
 * than by whoever next reads the manifests.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const RELEASE_MANIFEST = join("apps", "cloud", "package.json");
const PLUGIN_MANIFEST = join(".claude-plugin", "plugin.json");
const MARKETPLACE_MANIFEST = join(".claude-plugin", "marketplace.json");

/** The plugin this repository publishes; it is its own one-plugin marketplace. */
const PLUGIN_NAME = "crux";

/** Refuse rather than write half of it: a partial sync is worse than none. */
function refuse(message: string): never {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

function read(relPath: string): { raw: string; doc: unknown } {
  const raw = readFileSync(join(repoRoot, relPath), "utf8");
  try {
    return { raw, doc: JSON.parse(raw) as unknown };
  } catch (error) {
    return refuse(`${relPath} is not valid JSON: ${(error as Error).message}`);
  }
}

function versionOf(value: unknown, relPath: string, where: string): string {
  const version = (value as { version?: unknown } | undefined)?.version;
  if (typeof version !== "string" || version.length === 0) {
    refuse(`${relPath} has no version string at ${where}.`);
  }
  return version;
}

/**
 * The braces enclosing `index`, found by balancing outwards. Used to scope the
 * edit in `marketplace.json` to the crux plugin's own entry, so a marketplace
 * that grows a second plugin is still synced rather than refused.
 */
function enclosingObject(raw: string, index: number): { start: number; end: number } {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    if (raw[i] === "}") depth += 1;
    else if (raw[i] === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) refuse("could not find the object enclosing the crux plugin entry.");

  depth = 0;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth += 1;
    else if (raw[i] === "}") {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return refuse("the crux plugin entry has no closing brace.");
}

/** The region of the file holding the `version` field this sync owns. */
type Target = { relPath: string; current: string; raw: string; start: number; end: number };

function pluginTarget(): Target {
  const { raw, doc } = read(PLUGIN_MANIFEST);
  return {
    relPath: PLUGIN_MANIFEST,
    current: versionOf(doc, PLUGIN_MANIFEST, "the top level"),
    raw,
    start: 0,
    end: raw.length,
  };
}

function marketplaceTarget(): Target {
  const { raw, doc } = read(MARKETPLACE_MANIFEST);
  const plugins = (doc as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) refuse(`${MARKETPLACE_MANIFEST} has no plugins array.`);

  const entryIndex = plugins.findIndex(
    (plugin) => (plugin as { name?: unknown }).name === PLUGIN_NAME,
  );
  if (entryIndex === -1) {
    refuse(`${MARKETPLACE_MANIFEST} lists no plugin named "${PLUGIN_NAME}".`);
  }

  const nameMatch = raw.search(new RegExp(`"name"\\s*:\\s*"${PLUGIN_NAME}"`));
  if (nameMatch === -1) {
    refuse(`${MARKETPLACE_MANIFEST} names "${PLUGIN_NAME}" in a shape this sync cannot locate.`);
  }

  const { start, end } = enclosingObject(raw, nameMatch);
  return {
    relPath: MARKETPLACE_MANIFEST,
    current: versionOf(
      plugins[entryIndex],
      MARKETPLACE_MANIFEST,
      `plugins[${entryIndex}] ("${PLUGIN_NAME}")`,
    ),
    raw,
    start,
    end,
  };
}

/**
 * Edited as text rather than reserialized, so the manifests keep the shape a
 * human wrote them in and the release commit's diff is one line per file.
 */
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/g;

function rewrite(target: Target, version: string): string {
  const region = target.raw.slice(target.start, target.end);
  const matches = [...region.matchAll(VERSION_FIELD)];
  if (matches.length !== 1) {
    refuse(
      `${target.relPath} holds ${matches.length} version fields where this sync expected exactly one. Fix the manifest, or teach scripts/sync-plugin-version.ts which field is the plugin's.`,
    );
  }
  if (matches[0]![2] !== target.current) {
    refuse(
      `${target.relPath} reads "${target.current}" as JSON but "${matches[0]![2]}" as text — the field this sync would rewrite is not the one the manifest means.`,
    );
  }

  const next =
    target.raw.slice(0, target.start) +
    region.replace(VERSION_FIELD, `$1${version}$3`) +
    target.raw.slice(target.end);

  try {
    JSON.parse(next);
  } catch (error) {
    refuse(`rewriting ${target.relPath} produced invalid JSON: ${(error as Error).message}`);
  }
  return next;
}

const releaseVersion = versionOf(read(RELEASE_MANIFEST).doc, RELEASE_MANIFEST, "the top level");

let behind = 0;
for (const target of [pluginTarget(), marketplaceTarget()]) {
  if (target.current === releaseVersion) {
    console.log(`${target.relPath}: already ${releaseVersion}`);
    continue;
  }
  behind += 1;

  if (checkOnly) {
    console.error(`${target.relPath}: ${target.current}, expected ${releaseVersion}`);
    continue;
  }

  writeFileSync(join(repoRoot, target.relPath), rewrite(target, releaseVersion));
  console.log(`${target.relPath}: ${target.current} -> ${releaseVersion}`);
}

if (behind === 0) {
  console.log(`Plugin manifests agree with ${RELEASE_MANIFEST} (${releaseVersion}).`);
  process.exit(0);
}

if (checkOnly) {
  refuse(
    `${behind} plugin manifest(s) disagree with ${RELEASE_MANIFEST} (${releaseVersion}). Run \`bun run version:sync\` — the release version is bumped in ${RELEASE_MANIFEST} and copied from there.`,
  );
}

console.log(`Synced ${behind} manifest(s) to ${releaseVersion}.`);
