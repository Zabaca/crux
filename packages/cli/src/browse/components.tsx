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

const STATUS_COLOR: Record<string, Color> = {
  now: "red",
  next: "yellow",
  later: "blue",
  done: "green",
  abandoned: "gray",
};

export function SolutionStatusBadge({ status }: { status: string }): React.ReactElement {
  const color = SOLUTION_COLOR[status] ?? "white";
  return (
    <Text color={color} bold>
      [{status}]
    </Text>
  );
}

export function StatusBadge({ status }: { status: string | null }): React.ReactElement {
  if (!status) return <Text color="gray">[unscheduled]</Text>;
  const color = STATUS_COLOR[status] ?? "white";
  return (
    <Text color={color} bold>
      [{status}]
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
