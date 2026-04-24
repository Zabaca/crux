import Link from "next/link";
import { cn } from "@/lib/utils";

export function ArchiveToggle({
  basePath,
  showArchived,
}: {
  basePath: string;
  showArchived: boolean;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
      <Link
        href={basePath}
        className={cn(
          "rounded px-2 py-1",
          !showArchived ? "bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
      >
        Active
      </Link>
      <Link
        href={`${basePath}?show-archived=1`}
        className={cn(
          "rounded px-2 py-1",
          showArchived ? "bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
      >
        Show archived
      </Link>
    </div>
  );
}
