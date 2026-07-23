import "server-only";
import { expandDoc, findRepoRoot, walkDocs } from "@crux/core/docs";

/**
 * The Docs section derives everything on read (ADR-0002) — the same walker the
 * `docs:check` script runs, so the two can never disagree.
 */
function repoRoot(): string {
  return findRepoRoot(process.cwd());
}

export function readDocTree() {
  return walkDocs(repoRoot());
}

export function readDocSegments(path: string) {
  return expandDoc(repoRoot(), path);
}
