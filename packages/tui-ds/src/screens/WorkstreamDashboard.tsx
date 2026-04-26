import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb } from "../components/Breadcrumb.js";
import { KeyBar } from "../components/KeyBar.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { color } from "../tokens.js";

const problems = [
  {
    slug: "thinking-residue-gap",
    title: "Product thinking evaporates between sessions",
    status: "shaping",
    evidence: 3,
  },
  {
    slug: "onboarding-dropoff",
    title: "Users churn before first value moment",
    status: "committed",
    evidence: 7,
  },
  {
    slug: "context-reload-friction",
    title: "Reloading context takes too long manually",
    status: "shaping",
    evidence: 2,
  },
];

export function WorkstreamDashboard(): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Breadcrumb items={[{ label: "Workstreams" }, { label: "crux" }]} />
      <Box flexDirection="column" marginTop={1}>
        <Text bold>crux</Text>
        <Text color={color.dim}>
          Structured residue for product discovery done in Claude Code conversations.
        </Text>
      </Box>

      <Box flexDirection="row" marginTop={1} flexGrow={1}>
        <Box flexDirection="column" width="60%" paddingRight={1}>
          <ScrollableList
            onSelect={() => {}}
            items={problems.map((p) => ({
              slug: p.slug,
              title: p.title,
              badges: <StatusBadge variant="lifecycle" status={p.status} />,
              meta: `${p.evidence} evidence`,
            }))}
          />
        </Box>
        <Box flexDirection="column" width="40%" borderStyle="single" paddingX={1}>
          <Text color={color.muted} bold>
            QUEUES
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Box>
              <Text color={color.dim}>Intake </Text>
              <Text>4 unlinked</Text>
            </Box>
            <Box>
              <Text color={color.dim}>Ideas </Text>
              <Text>2 unpromoted</Text>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box flexGrow={1} />
      <Box marginTop={1}>
        <KeyBar
          hints={[
            { key: "↵", label: "open" },
            { key: "i", label: "intake" },
            { key: "d", label: "ideas" },
            { key: "a", label: "archived" },
            { key: "q", label: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
