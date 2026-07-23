/**
 * The doc-tree walker (ADR-0002).
 *
 * The project's documentation is whatever is *Reachable* from README: start
 * there and recursively follow internal markdown links and Claude Code
 * `@import`s. Derived on read — nothing is generated or committed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname, normalize } from "node:path/posix";

/** The doc tree is rooted here, always. */
export const ROOT_DOC = "README.md";

/** Agent machinery lives outside the doc tree entirely (ADR-0002). */
const EXCLUDED_PREFIXES = [
  ".claude/",
  ".agents/",
  "skills/",
  ".fredrin/",
  "node_modules/",
  ".git/",
];

export type LinkVia = "link" | "import";

export type DocLink = {
  /** Repo-relative doc that contains the link. */
  from: string;
  /** The href exactly as written. */
  raw: string;
  /** Repo-relative target, fragment and query stripped. */
  target: string;
  via: LinkVia;
  exists: boolean;
  /** A markdown doc inside the tree — recursed into and rendered. */
  walkable: boolean;
};

export type DocNode = {
  /** Repo-relative path. */
  path: string;
  links: DocLink[];
  /** Docs first reached from this node. */
  children: DocNode[];
};

export type BrokenLink = { from: string; raw: string; target: string };

export type DocRot = { brokenLinks: BrokenLink[]; orphans: string[] };

export type DocTreeResult = {
  tree: DocNode;
  /** Every reachable doc, in walk order, starting at README. */
  reachable: string[];
  rot: DocRot;
};

const FENCE = /^([ \t]*)(```|~~~)[\s\S]*?^\1\2[^\n]*$/gm;
const CODE_SPAN = /`[^`\n]*`/g;

/** Fenced code blocks and inline code spans are prose, not links. */
function stripCode(source: string): string {
  return source.replace(FENCE, "").replace(CODE_SPAN, "");
}

/** `[start, end)` offsets of every code region, for callers working on offsets. */
export function codeRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const re of [FENCE, CODE_SPAN]) {
    for (const m of source.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

const MARKDOWN_LINK = /!?\[[^\]]*\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
// A Claude Code @import: a path-shaped token, not preceded by a word character
// (so `you@example.com` is an email, not an import). Group 1 is the leading
// boundary character; group 2 is the path.
export const IMPORT = /(^|[\s(])@((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\/?)/g;

/** `@import` only refers to a file — `@media`, `@param` and friends do not. */
export function isPathLike(raw: string): boolean {
  return raw.includes("/") || /\.[A-Za-z0-9]+$/.test(raw);
}

function rawLinks(source: string): Array<{ raw: string; via: LinkVia }> {
  const prose = stripCode(source);
  const out: Array<{ raw: string; via: LinkVia }> = [];
  for (const m of prose.matchAll(MARKDOWN_LINK)) out.push({ raw: m[1]!, via: "link" });
  for (const m of prose.matchAll(IMPORT)) {
    if (isPathLike(m[2]!)) out.push({ raw: m[2]!, via: "import" });
  }
  return out;
}

function isExternal(raw: string): boolean {
  return raw.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw);
}

export function isExcluded(target: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => target === p.slice(0, -1) || target.startsWith(p));
}

/**
 * Resolve an href written in `from` to a repo-relative path, or null when it is
 * external, a bare fragment, or escapes the repo.
 */
export function resolveLink(from: string, raw: string): string | null {
  if (!raw || raw.startsWith("#") || isExternal(raw)) return null;
  const bare = raw.split("#")[0]!.split("?")[0]!;
  if (!bare) return null;
  const target = normalize(bare.startsWith("/") ? bare.slice(1) : join(dirname(from), bare));
  if (target.startsWith("..") || target === "." || target === "") return null;
  return target.replace(/\/$/, "");
}

/** True when `target` is a markdown file inside the doc tree. */
export function isDocFile(repoRoot: string, target: string): boolean {
  if (!target.endsWith(".md") || isExcluded(target)) return false;
  const abs = join(repoRoot, target);
  return existsSync(abs) && statSync(abs).isFile();
}

function readDoc(repoRoot: string, path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

export function docLinks(repoRoot: string, from: string, source: string): DocLink[] {
  const seen = new Set<string>();
  const links: DocLink[] = [];
  for (const { raw, via } of rawLinks(source)) {
    const target = resolveLink(from, raw);
    if (target === null) continue;
    const key = `${via}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      from,
      raw,
      target,
      via,
      exists: existsSync(join(repoRoot, target)),
      walkable: isDocFile(repoRoot, target),
    });
  }
  return links;
}

export function walkDocs(repoRoot: string): DocTreeResult {
  const visited = new Set<string>([ROOT_DOC]);
  const reachable: string[] = [ROOT_DOC];

  const brokenLinks: BrokenLink[] = [];

  const visit = (path: string): DocNode => {
    const links = docLinks(repoRoot, path, readDoc(repoRoot, path));
    const children: DocNode[] = [];
    for (const link of links) {
      if (!link.exists) brokenLinks.push({ from: link.from, raw: link.raw, target: link.target });
      if (!link.walkable || visited.has(link.target)) continue;
      visited.add(link.target);
      reachable.push(link.target);
      children.push(visit(link.target));
    }
    return { path, links, children };
  };

  const tree = visit(ROOT_DOC);
  const orphans = orphanCandidates(repoRoot).filter((p) => !visited.has(p));
  return { tree, reachable, rot: { brokenLinks, orphans } };
}

/**
 * Every doc that is expected to be Reachable: markdown under `docs/`, plus the
 * root glossary. Anything here the walker cannot reach is an orphan.
 */
function orphanCandidates(repoRoot: string): string[] {
  const found: string[] = [];
  if (existsSync(join(repoRoot, "CONTEXT.md"))) found.push("CONTEXT.md");

  const walkDir = (rel: string) => {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = `${rel}/${entry.name}`;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) walkDir(child);
      else if (entry.name.endsWith(".md")) found.push(child);
    }
  };
  walkDir("docs");

  return found;
}
