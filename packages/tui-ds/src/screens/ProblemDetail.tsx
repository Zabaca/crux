import React from "react";
import { Box, Text } from "ink";
import { Breadcrumb } from "../components/Breadcrumb.js";
import { DetailPane, DetailSection } from "../components/DetailPane.js";
import { KeyBar } from "../components/KeyBar.js";
import { ListRow } from "../components/ListRow.js";
import { StatusBadge } from "../components/StatusBadge.js";

const problem = {
  slug: "thinking-residue-gap",
  title: "Product thinking evaporates between sessions",
  status: "shaping",
  priority: "P1",
};

const evidence = [
  { id: "obs-017", content: "Restart cost dominates short engagements" },
  { id: "obs-031", content: "Parallel workstreams drift undetected" },
  { id: "obs-042", content: "No correction path after wrong filing" },
];

const solutions = [
  {
    slug: "build-crux",
    title: "Build Crux as a structured residue CLI",
    status: "shaping",
  },
  {
    slug: "notion-backend",
    title: "Use Notion as a lightweight backend",
    status: "proposed",
  },
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

          <DetailSection label={`Solutions (${solutions.length})`}>
            {solutions.map((s) => (
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
            { key: "s", label: "solution" },
            { key: "o", label: "observation" },
            { key: "←", label: "back" },
            { key: "q", label: "quit" },
          ]}
        />
      </Box>
    </Box>
  );
}
