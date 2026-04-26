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
    title: "Discovery thinking has no structured residue across conversations or projects",
    status: "shaping",
    priority: "P0",
    evidence: 11,
    solutions: 4,
  },
  {
    slug: "schema-change-destroys-residue",
    title: "Schema-change verification workflow destroyed dogfooded state",
    status: "shaping",
    priority: "P1",
    evidence: 1,
    solutions: 3,
  },
  {
    slug: "silent-env-override-misroutes-data",
    title: "bin/crux dev-mode guard silently misroutes real user data to wrong db",
    status: "shaping",
    priority: "P1",
    evidence: 2,
    solutions: 3,
  },
  {
    slug: "observation-correction-gap",
    title: "Observations have no correction path after wrong filing",
    status: "shaping",
    priority: "P2",
    evidence: 1,
    solutions: 2,
  },
  {
    slug: "external-intake-gap",
    title: "Inbound external signals have no structured intake path",
    status: "shaping",
    priority: "P2",
    evidence: 2,
    solutions: 0,
  },
  {
    slug: "skill-proposal-form-mismatch",
    title: "Skill proposal pattern required CLI form, burying substance under shell syntax",
    status: "shaping",
    priority: "P2",
    evidence: 1,
    solutions: 2,
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
              badges: <StatusBadge variant="priority" tier={p.priority} />,
              meta: `ev:${p.evidence} sol:${p.solutions}`,
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
