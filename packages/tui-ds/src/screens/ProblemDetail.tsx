import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb } from "../components/Breadcrumb.js";
import { DetailPane, DetailSection } from "../components/DetailPane.js";
import { KeyBar } from "../components/KeyBar.js";
import { ListRow } from "../components/ListRow.js";
import { StatusBadge } from "../components/StatusBadge.js";

const problem = {
  slug: "thinking-residue-gap",
  title: "Discovery thinking has no structured residue across conversations or projects",
  status: "shaping",
  priority: "P0",
};

const evidence = [
  {
    id: "OBS-001",
    content:
      "Discovery thinking vanishes when conversations end — no structured capture path exists",
  },
  {
    id: "OBS-003",
    content:
      "Modesk: concrete forcing instance — historical engagement where context loss directly cost re-work",
  },
  {
    id: "OBS-005",
    content:
      "Notion has a hosted MCP server for Claude Code but is read-only; can't write structured state",
  },
  {
    id: "OBS-006",
    content: "Linear MCP covers execution tracking, not upstream product thinking",
  },
  {
    id: "OBS-007",
    content: "Productboard fits the shape but not the economics for a solo practitioner",
  },
];

const attempts = [
  { slug: "ATT-001", title: "Build the CLI and the entity model — CRUX-1", status: "shipped" },
  { slug: "ATT-002", title: "Notion as storage backend — CRUX-4", status: "dropped" },
  { slug: "ATT-003", title: "Roadmap board in the browser — CRUX-9", status: "open" },
];

export function ProblemDetail(): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Breadcrumb items={[{ label: "Workstreams" }, { label: "crux" }, { label: problem.slug }]} />

      <Box marginTop={1} flexDirection="column">
        <DetailPane
          title={problem.title}
          subtitle={problem.slug}
          badges={
            <>
              <StatusBadge variant="lifecycle" status={problem.status} />
              <Text> </Text>
              <StatusBadge variant="priority" tier={problem.priority} />
            </>
          }
        >
          <DetailSection label={`Evidence (${evidence.length})`}>
            {evidence.map((e) => (
              <Text key={e.id}>
                · {e.id} — {e.content}
              </Text>
            ))}
          </DetailSection>

          <DetailSection label={`Attempts (${attempts.length})`}>
            {attempts.map((s) => (
              <ListRow
                key={s.slug}
                slug={s.slug}
                title={s.title}
                badges={<StatusBadge variant="lifecycle" status={s.status} />}
              />
            ))}
          </DetailSection>
        </DetailPane>
      </Box>

      <Box flexGrow={1} />
      <Box marginTop={1}>
        <KeyBar
          hints={[
            { key: "a", label: "attempt" },
            { key: "o", label: "observation" },
            { key: "←", label: "back" },
            { key: "q", label: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
