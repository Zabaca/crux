/** Human-readable structural Rot report, shared by `docs:check` and the web UI. */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { DocRot } from "./walk.js";

export function hasRot(rot: DocRot): boolean {
  return rot.brokenLinks.length > 0 || rot.orphans.length > 0;
}

export function formatRot(rot: DocRot): string {
  if (!hasRot(rot)) return "docs: no rot — every doc is reachable from README.";

  const lines: string[] = ["docs: structural rot found."];
  if (rot.brokenLinks.length > 0) {
    lines.push("", `Broken links (${rot.brokenLinks.length}):`);
    for (const link of rot.brokenLinks) lines.push(`  ${link.from} → ${link.target}`);
  }
  if (rot.orphans.length > 0) {
    lines.push("", `Orphans — unreachable from README (${rot.orphans.length}):`);
    for (const orphan of rot.orphans) lines.push(`  ${orphan}`);
  }
  return lines.join("\n");
}

/** Walk up from `startDir` to the repo root (the directory holding `.git`). */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`docs: no repo root (.git) above ${startDir}`);
    dir = parent;
  }
}
