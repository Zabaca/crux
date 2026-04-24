import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        // Status colors per spec — match TUI conventions.
        chosen:
          "border-transparent bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
        shipped: "border-transparent bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100",
        proposed:
          "border-transparent bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100",
        rejected: "border-transparent bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
        evaluated:
          "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100",
        archived:
          "border-transparent bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
        // Lifecycle
        shaping:
          "border-transparent bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100",
        committed:
          "border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
        shipping:
          "border-transparent bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100",
        abandoned:
          "border-transparent bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
        // Priority tiers
        p0: "border-transparent bg-red-600 text-white",
        p1: "border-transparent bg-orange-500 text-white",
        p2: "border-transparent bg-amber-400 text-amber-950",
        p3: "border-transparent bg-stone-300 text-stone-800",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export function statusVariant(status: string | null | undefined): BadgeVariant {
  switch (status) {
    case "chosen":
    case "shipped":
    case "proposed":
    case "rejected":
    case "evaluated":
    case "archived":
    case "shaping":
    case "committed":
    case "shipping":
    case "abandoned":
      return status;
    default:
      return "secondary";
  }
}

export function priorityVariant(tier: string | null | undefined): BadgeVariant {
  switch (tier) {
    case "P0":
      return "p0";
    case "P1":
      return "p1";
    case "P2":
      return "p2";
    case "P3":
      return "p3";
    default:
      return "outline";
  }
}
