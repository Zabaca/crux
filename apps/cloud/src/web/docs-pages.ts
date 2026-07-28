/**
 * `/docs` — the README-rooted doc tree of the commit this Worker was built from.
 *
 * The tree itself is not walked here. `scripts/build-docs.ts` runs the one
 * walker in `@crux/core/docs` at build time and emits `src/generated/docs-tree.ts`
 * (ADR-0005); this file only renders it. That split is what keeps the walker
 * singular *and* keeps `node:fs` out of the Worker bundle — `@crux/core/docs`
 * reads the filesystem and must never be imported from here.
 *
 * Links are rewritten so the tree navigates in-UI: an internal link to a doc
 * becomes `/docs/<repo-relative path>`, an internal link to code stays pointing
 * at the repo path (there is nothing to render for it), and external links are
 * left exactly as written.
 */
import { marked } from "marked";

import { DOCS, DOCS_ROOT } from "../generated/docs-tree.js";
import { html, raw, escapeHtml, type Html } from "./html.js";

/** Raised when a path is not a doc in the tree — rendered as the 404 page. */
export class DocNotFound extends Error {}

/** Resolve an href written in `from` against the tree, or null to leave it be. */
function resolveHref(from: string, href: string): string | null {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return null;
  }
  const [bare, hash] = splitHash(href);
  if (!bare) return null;
  const segments = bare.startsWith("/")
    ? bare.slice(1).split("/")
    : [...from.split("/").slice(0, -1), ...bare.split("/")];
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  const target = stack.join("/");
  if (!target || !(target in DOCS)) return null;
  return `/docs/${target}${hash}`;
}

function splitHash(href: string): [string, string] {
  const at = href.indexOf("#");
  return at === -1 ? [href, ""] : [href.slice(0, at), href.slice(at)];
}

/** Render one doc's markdown, with in-tree links pointed at their `/docs` URLs. */
function renderMarkdown(path: string, source: string): Html {
  const renderer = new marked.Renderer();
  const base = renderer.link.bind(renderer);
  renderer.link = (token) => {
    const rewritten = resolveHref(path, token.href);
    return base(rewritten ? { ...token, href: rewritten } : token);
  };
  return raw(marked.parse(source, { renderer, async: false, gfm: true }) as string);
}

/** The doc tree's own navigation: every reachable doc, README first. */
function docNav(current: string): Html {
  const paths = Object.keys(DOCS);
  return html`<nav class="docnav">
    ${paths.map(
      (p) =>
        html`<a class="docnav-item ${p === current ? "here" : ""}" href="/docs/${p}"
          >${p === DOCS_ROOT ? "README" : p}</a
        >`,
    )}
  </nav>`;
}

/**
 * `/docs` and `/docs/<path>`. `path` is undefined at the section root, which is
 * README — the landing page, because the tree is defined as what it reaches.
 */
export function docPage(path?: string): { title: string; body: Html } {
  const target = path && path !== "" ? path : DOCS_ROOT;
  const source = DOCS[target];
  if (source === undefined) throw new DocNotFound(`no doc at ${target}`);

  const body = html`
    <div class="crumb">
      <a href="/docs">Docs</a>${target === DOCS_ROOT ? "" : raw(` / ${escapeHtml(target)}`)}
    </div>
    <div class="split docs">
      ${docNav(target)}
      <article class="doc panel">
        <div class="pad">${renderMarkdown(target, source)}</div>
      </article>
    </div>
  `;
  return { title: target === DOCS_ROOT ? "Docs" : target, body };
}
