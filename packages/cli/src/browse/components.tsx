import React from "react";
import { Box, Text } from "ink";
import { KeyBar } from "@crux/tui-ds/components";
import type { ArchiveBlock } from "./queries.js";

type Color = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray";

const SOLUTION_COLOR: Record<string, Color> = {
  chosen: "green",
  shipped: "cyan",
  proposed: "yellow",
  rejected: "red",
  evaluated: "blue",
};

const LIFECYCLE_COLOR: Record<string, Color> = {
  shaping: "yellow",
  committed: "blue",
  shipping: "cyan",
  shipped: "green",
  abandoned: "gray",
};

const PRIORITY_COLOR: Record<string, Color> = {
  P0: "red",
  P1: "yellow",
  P2: "blue",
  P3: "gray",
};

export function SolutionStatusBadge({ status }: { status: string }): React.ReactElement {
  const color = SOLUTION_COLOR[status] ?? "white";
  return (
    <Text color={color} bold>
      [{status}]
    </Text>
  );
}

export function LifecycleBadge({ status }: { status: string }): React.ReactElement {
  const color = LIFECYCLE_COLOR[status] ?? "white";
  return (
    <Text color={color} bold>
      [{status}]
    </Text>
  );
}

export function PriorityBadge({ tier }: { tier: string | null }): React.ReactElement {
  if (!tier) return <Text color="gray">[--]</Text>;
  const color = PRIORITY_COLOR[tier] ?? "white";
  return (
    <Text color={color} bold>
      [{tier}]
    </Text>
  );
}

export function ArchivedTag({ archive }: { archive: ArchiveBlock }): React.ReactElement | null {
  if (!archive) return null;
  return <Text color="gray"> [archived{archive.rationale ? `: ${archive.rationale}` : ""}]</Text>;
}

export function SectionTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text bold underline>
        {children}
      </Text>
    </Box>
  );
}

export function Empty({ label }: { label: string }): React.ReactElement {
  return <Text color="gray">— {label} —</Text>;
}

export function Footer({ hints }: { hints: Array<[string, string]> }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <KeyBar hints={hints.map(([key, label]) => ({ key, label }))} />
    </Box>
  );
}
