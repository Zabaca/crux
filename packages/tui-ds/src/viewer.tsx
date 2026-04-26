import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { StatusBadge } from "./components/StatusBadge.js";
import { KeyBar } from "./components/KeyBar.js";
import { ListRow } from "./components/ListRow.js";
import { DetailPane, DetailSection } from "./components/DetailPane.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { EmptyState } from "./components/EmptyState.js";
import { ScrollableList } from "./components/ScrollableList.js";
import { color } from "./tokens.js";

type SectionDef = { title: string; content: React.ReactElement };

const sections: SectionDef[] = [
  {
    title: "StatusBadge",
    content: (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color={color.muted}>lifecycle</Text>
          <Box gap={1}>
            <StatusBadge variant="lifecycle" status="shaping" />
            <StatusBadge variant="lifecycle" status="committed" />
            <StatusBadge variant="lifecycle" status="shipped" />
            <StatusBadge variant="lifecycle" status="abandoned" />
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text color={color.muted}>priority</Text>
          <Box gap={1}>
            <StatusBadge variant="priority" tier="P0" />
            <StatusBadge variant="priority" tier="P1" />
            <StatusBadge variant="priority" tier="P2" />
            <StatusBadge variant="priority" tier="P3" />
            <StatusBadge variant="priority" tier={null} />
          </Box>
        </Box>
      </Box>
    ),
  },
  {
    title: "KeyBar",
    content: (
      <KeyBar
        hints={[
          { key: "q", label: "quit" },
          { key: "←", label: "back" },
          { key: "a", label: "archived" },
          { key: "/", label: "search" },
        ]}
      />
    ),
  },
  {
    title: "ListRow",
    content: (
      <Box flexDirection="column">
        <ListRow
          focused
          slug="thinking-residue-gap"
          title="Product thinking evaporates between sessions"
          badges={<StatusBadge variant="lifecycle" status="shaping" />}
          meta="3 evidence"
        />
        <ListRow
          slug="thinking-residue-gap"
          title="Product thinking evaporates between sessions"
          badges={<StatusBadge variant="lifecycle" status="shaping" />}
          meta="3 evidence"
        />
        <ListRow
          slug="onboarding-dropoff"
          title="Users churn before first value moment"
          badges={<StatusBadge variant="priority" tier="P0" />}
          meta="7 evidence"
        />
        <ListRow slug="obs-042" title="GitHub issue: no correction path after wrong filing" />
      </Box>
    ),
  },
  {
    title: "DetailPane",
    content: (
      <DetailPane
        title="Product thinking evaporates between sessions"
        subtitle="thinking-residue-gap"
        badges={
          <>
            <StatusBadge variant="lifecycle" status="shaping" />
            <Text> </Text>
            <StatusBadge variant="priority" tier="P1" />
          </>
        }
      >
        <DetailSection label="Description">
          <Text wrap="wrap">
            Each Claude Code session starts cold. Decisions, rationale, and direction from prior
            sessions aren't reloadable — they exist only in scrollback or memory.
          </Text>
        </DetailSection>
        <DetailSection label="Evidence (2)">
          <Text>· obs-017 — restart cost dominates short engagements</Text>
          <Text>· obs-031 — parallel workstreams drift undetected</Text>
        </DetailSection>
      </DetailPane>
    ),
  },
  {
    title: "Breadcrumb",
    content: (
      <Breadcrumb
        items={[{ label: "Workstreams" }, { label: "crux" }, { label: "thinking-residue-gap" }]}
      />
    ),
  },
  {
    title: "EmptyState",
    content: <EmptyState>No open problems.</EmptyState>,
  },
  {
    title: "ScrollableList",
    content: (
      <ScrollableList
        onSelect={() => {}}
        items={[
          {
            slug: "thinking-residue-gap",
            title: "Product thinking evaporates between sessions",
            badges: <StatusBadge variant="lifecycle" status="shaping" />,
            meta: "3 evidence",
          },
          {
            slug: "onboarding-dropoff",
            title: "Users churn before first value moment",
            badges: <StatusBadge variant="priority" tier="P0" />,
            meta: "7 evidence",
          },
          {
            slug: "context-reload-friction",
            title: "Reloading context takes too long manually",
            badges: <StatusBadge variant="lifecycle" status="committed" />,
            meta: "2 evidence",
          },
        ]}
      />
    ),
  },
];

function Viewer(): React.ReactElement {
  const { exit } = useApp();
  const [idx, setIdx] = useState(0);
  const section = sections[idx]!;

  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }
    if (key.rightArrow || input === "l") setIdx((i) => Math.min(i + 1, sections.length - 1));
    if (key.leftArrow || input === "h") setIdx((i) => Math.max(i - 1, 0));
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={color.accent}>
          {section.title}
        </Text>
        <Text color={color.dim}>
          {" "}
          — {idx + 1}/{sections.length} · ← → to navigate · q quit
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {section.content}
      </Box>
    </Box>
  );
}

const instance = render(<Viewer />, { alternateScreen: true });
await instance.waitUntilExit();
