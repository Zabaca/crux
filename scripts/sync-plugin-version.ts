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
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const RELEASE_MANIFEST = join("apps", "cloud", "package.json");
const PLUGIN_MANIFESTS = [
  join(".claude-plugin", "plugin.json"),
  join(".claude-plugin", "marketplace.json"),
];

/** Refuse rather than write half of it: a partial sync is worse than none. */
function refuse(message: string): never {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

function readVersion(relPath: string): string {
  const raw = readFileSync(join(repoRoot, relPath), "utf8");
  const version = (JSON.parse(raw) as { version?: unknown }).version;
  if (typeof version !== "string" || version.length === 0) {
    refuse(`${relPath} has no version string.`);
  }
  return version;
}

const releaseVersion = readVersion(RELEASE_MANIFEST);

/**
 * Edited as text rather than reserialized, so the manifests keep the shape a
 * human wrote them in and the release commit's diff is one line per file.
 */
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/g;

let changed = 0;
for (const relPath of PLUGIN_MANIFESTS) {
  const path = join(repoRoot, relPath);
  const raw = readFileSync(path, "utf8");

  const matches = [...raw.matchAll(VERSION_FIELD)];
  if (matches.length !== 1) {
    refuse(
      `${relPath} holds ${matches.length} version fields, and this sync only knows how to move one. Move it by hand and say here which one is the plugin's.`,
    );
  }

  const current = matches[0]![2];
  if (current === releaseVersion) {
    console.log(`${relPath}: already ${releaseVersion}`);
    continue;
  }

  writeFileSync(path, raw.replace(VERSION_FIELD, `$1${releaseVersion}$3`));
  console.log(`${relPath}: ${current} -> ${releaseVersion}`);
  changed += 1;
}

console.log(
  changed === 0
    ? `Plugin manifests already agree with ${RELEASE_MANIFEST} (${releaseVersion}).`
    : `Synced ${changed} manifest(s) to ${releaseVersion}.`,
);
