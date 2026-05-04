"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkstreamNavRow } from "./workstream-nav-row";

const STORAGE_KEY = "crux:nav:collapsed";

export type WorkstreamNavItem = {
  slug: string;
  title: string;
  archived: boolean;
  openProblemCount: number;
  totalProblemCount: number;
};

export function WorkstreamNavShell({ items }: { items: WorkstreamNavItem[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed, hydrated]);

  const activeSlug = (() => {
    const m = pathname?.match(/^\/w\/([^/]+)/);
    return m ? m[1] : null;
  })();

  if (items.length === 0) return null;

  return (
    <aside
      className={cn(
        "shrink-0 border-r bg-card transition-[width] duration-150",
        collapsed ? "w-12" : "w-60",
      )}
    >
      <div className="flex items-center justify-between border-b px-2 py-2">
        {collapsed ? null : (
          <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workstreams
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand" : "Collapse"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className={cn("flex flex-col gap-1 p-2", collapsed && "items-center")}>
        {items.map((it) => (
          <WorkstreamNavRow
            key={it.slug}
            {...it}
            active={activeSlug === it.slug}
            collapsed={collapsed}
          />
        ))}
      </nav>
    </aside>
  );
}
