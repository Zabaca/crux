import React from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { StatusBadge } from "./components/StatusBadge.js";
import { KeyBar } from "./components/KeyBar.js";
import { ListRow } from "./components/ListRow.js";
import { DetailPane, DetailSection } from "./components/DetailPane.js";
import { Breadcrumb } from "./components/Breadcrumb.js";
import { EmptyState } from "./components/EmptyState.js";
import { ScrollableList } from "./components/ScrollableList.js";
import { color } from "./tokens.js";

function Divider(): React.ReactElement {
  return <Text color={color.dim}>{"─".repeat(60)}</Text>;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color={color.accent} bold>
        {title}
      </Text>
      <Box marginTop={1}>{children}</Box>
    </Box>
  );
}

function Viewer(): React.ReactElement {
  const { exit } = useApp();
  useInput((input) => {
    if (input === "q") exit();
  });

  return (
    <Box flexDirection="column" height={process.stdout.rows} paddingX={1}>
      <Text bold>crux · tui design system</Text>
      <Divider />

      <Section title="StatusBadge — lifecycle">
        <Box>
          <StatusBadge variant="lifecycle" status="shaping" />
          <Text> </Text>
          <StatusBadge variant="lifecycle" status="committed" />
          <Text> </Text>
          <StatusBadge variant="lifecycle" status="shipped" />
          <Text> </Text>
          <StatusBadge variant="lifecycle" status="abandoned" />
        </Box>
      </Section>

      <Section title="StatusBadge — priority">
        <Box>
          <StatusBadge variant="priority" tier="P0" />
          <Text> </Text>
          <StatusBadge variant="priority" tier="P1" />
          <Text> </Text>
          <StatusBadge variant="priority" tier="P2" />
          <Text> </Text>
          <StatusBadge variant="priority" tier="P3" />
          <Text> </Text>
          <StatusBadge variant="priority" tier={null} />
        </Box>
      </Section>

      <Section title="KeyBar">
        <KeyBar
          hints={[
            { key: "q", label: "quit" },
            { key: "←", label: "back" },
            { key: "a", label: "archived" },
            { key: "/", label: "search" },
          ]}
        />
      </Section>

      <Section title="ListRow — variants">
        <Box flexDirection="column" width="100%">
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
      </Section>

      <Section title="DetailPane">
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
            <Text>
              Each Claude Code session starts cold. Decisions, rationale, and direction from prior
              sessions aren't reloadable — they exist only in scrollback or memory.
            </Text>
          </DetailSection>
          <DetailSection label="Evidence (2)">
            <Text>· obs-017 — restart cost dominates short engagements</Text>
            <Text>· obs-031 — parallel workstreams drift undetected</Text>
          </DetailSection>
        </DetailPane>
      </Section>

      <Section title="Breadcrumb">
        <Breadcrumb
          items={[{ label: "Workstreams" }, { label: "crux" }, { label: "thinking-residue-gap" }]}
        />
      </Section>

      <Section title="EmptyState">
        <EmptyState>No open problems.</EmptyState>
      </Section>

      <Section title="ScrollableList">
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
      </Section>

      <Divider />
      <Text color={color.dim}>press q to exit</Text>
    </Box>
  );
}

const instance = render(<Viewer />, { alternateScreen: true });
await instance.waitUntilExit();
