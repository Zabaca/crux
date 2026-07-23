/**
 * Inline expansion of Claude Code `@import`s, so a rendered doc shows exactly
 * what an agent sees when it loads the file (ADR-0002).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { IMPORT, codeRanges, isDocFile, isPathLike, resolveLink } from "./walk.js";

export type DocSegment = {
  /** Repo-relative path of the file this text came from. */
  path: string;
  source: string;
  /** The doc whose `@import` pulled this in, or null for the doc's own text. */
  importedFrom: string | null;
};

/**
 * Split a doc into segments, replacing every `@import` of a markdown file with
 * the imported file's own segments. An import that is missing, non-markdown, or
 * would close a cycle is left in place as literal text.
 */
export function expandDoc(repoRoot: string, path: string): DocSegment[] {
  const segments: DocSegment[] = [];
  const push = (segment: DocSegment) => {
    if (segment.source.trim() !== "") segments.push(segment);
  };

  const expand = (docPath: string, importedFrom: string | null, stack: Set<string>) => {
    const source = readFileSync(join(repoRoot, docPath), "utf8");
    const ranges = codeRanges(source);
    let cursor = 0;

    for (const m of source.matchAll(IMPORT)) {
      const at = m.index + m[1]!.length;
      if (at < cursor) continue;
      if (ranges.some(([start, end]) => at >= start && at < end)) continue;
      if (!isPathLike(m[2]!)) continue;
      const target = resolveLink(docPath, m[2]!);
      if (!target || !isDocFile(repoRoot, target) || stack.has(target)) continue;

      push({ path: docPath, source: source.slice(cursor, at), importedFrom });
      cursor = at + 1 + m[2]!.length;
      expand(target, docPath, new Set([...stack, target]));
    }

    push({ path: docPath, source: source.slice(cursor), importedFrom });
  };

  expand(path, null, new Set([path]));
  return segments;
}
