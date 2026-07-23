import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { docHref } from "@/lib/docs-links";

/** Render one doc segment, rewriting its links relative to `from`. */
export function DocMarkdown({ from, source }: { from: string; source: string }) {
  const components: Components = {
    a({ href, children }) {
      const link = docHref(from, href ?? "");
      if (link.kind === "doc") return <Link href={link.href}>{children}</Link>;
      if (link.kind === "external")
        return (
          <a href={link.href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      return <code>{link.target}</code>;
    },
  };

  return (
    <div className="doc-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
