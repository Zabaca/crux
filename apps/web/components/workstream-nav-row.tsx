"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function WorkstreamNavRow({
  slug,
  title,
  archived,
  openProblemCount,
  totalProblemCount,
  active,
  collapsed,
}: {
  slug: string;
  title: string;
  archived: boolean;
  openProblemCount: number;
  totalProblemCount: number;
  active: boolean;
  collapsed: boolean;
}) {
  const tooltip = `${slug} — ${openProblemCount} open / ${totalProblemCount} total`;
  if (collapsed) {
    return (
      <Link
        href={`/w/${slug}`}
        title={tooltip}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md font-mono text-sm",
          archived && "opacity-60",
          active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        )}
      >
        {slug.charAt(0).toUpperCase()}
      </Link>
    );
  }
  return (
    <Link
      href={`/w/${slug}`}
      title={tooltip}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm",
        archived && "opacity-60",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <span className="truncate">{slug}</span>
          {archived ? <Badge variant="archived">archived</Badge> : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <span className="font-mono text-foreground">{openProblemCount}</span>
        <span className="mx-0.5">/</span>
        <span>{totalProblemCount}</span>
      </div>
    </Link>
  );
}
