import { cn } from "@/lib/utils";

export function EmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
