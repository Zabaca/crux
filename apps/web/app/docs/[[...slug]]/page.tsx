import Link from "next/link";
import { notFound } from "next/navigation";
import { ROOT_DOC, type DocNode } from "@crux/core/docs";

import { readDocSegments, readDocTree } from "@/lib/docs";
import { PageShell } from "@/components/page-shell";
import { DocMarkdown } from "@/components/doc-markdown";
import { DocsRotBanner } from "@/components/docs-rot-banner";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function TreeBranch({ node, current }: { node: DocNode; current: string }) {
  return (
    <li>
      <Link
        href={node.path === ROOT_DOC ? "/docs" : `/docs/${node.path}`}
        className={cn(
          "block truncate rounded px-2 py-1 font-mono text-xs hover:bg-accent/50",
          node.path === current ? "bg-accent text-accent-foreground" : "text-muted-foreground",
        )}
        title={node.path}
      >
        {node.path}
      </Link>
      {node.children.length > 0 ? (
        <ul className="ml-2 border-l pl-1">
          {node.children.map((child) => (
            <TreeBranch key={child.path} node={child} current={current} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const path = slug?.length ? slug.map(decodeURIComponent).join("/") : ROOT_DOC;

  const { tree, reachable, rot } = readDocTree();
  // Only docs Reachable from README are served — no URL guessing into the repo.
  if (!reachable.includes(path)) notFound();

  const segments = readDocSegments(path);

  return (
    <PageShell
      breadcrumbs={[
        { href: "/", label: "Workstreams" },
        ...(path === ROOT_DOC ? [{ label: "Docs" }] : [{ href: "/docs", label: "Docs" }]),
        ...(path === ROOT_DOC ? [] : [{ label: path }]),
      ]}
      title="Docs"
      subtitle="Whatever is reachable from README, walked live at read time."
    >
      <DocsRotBanner rot={rot} />
      <div className="flex gap-8 items-start">
        <nav className="w-64 shrink-0">
          <ul>
            <TreeBranch node={tree} current={path} />
          </ul>
        </nav>
        <article className="min-w-0 flex-1 space-y-4">
          {segments.map((segment, i) => (
            <div
              key={`${segment.path}:${i}`}
              className={segment.importedFrom ? "border-l-2 pl-4" : undefined}
            >
              {segment.importedFrom ? (
                <div className="pb-1 font-mono text-xs text-muted-foreground">@{segment.path}</div>
              ) : null}
              <DocMarkdown from={segment.path} source={segment.source} />
            </div>
          ))}
        </article>
      </div>
    </PageShell>
  );
}
