import { isExcluded, resolveLink } from "@crux/core/docs";

export type DocHref =
  /** External URL or bare fragment — left exactly as written. */
  | { kind: "external"; href: string }
  /** A doc in the tree — rewritten to navigate inside the UI. */
  | { kind: "doc"; href: string }
  /** An internal path we don't serve (code, agent machinery) — shown as text. */
  | { kind: "path"; target: string };

/** Where a link written in `from` should point inside the Docs section. */
export function docHref(from: string, raw: string): DocHref {
  const target = resolveLink(from, raw);
  if (target === null) return { kind: "external", href: raw };
  if (target.endsWith(".md") && !isExcluded(target))
    return { kind: "doc", href: `/docs/${target}` };
  return { kind: "path", target };
}
