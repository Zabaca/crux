import React from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { StatusBadge } from "./components/StatusBadge.js";
import { KeyBar } from "./components/KeyBar.js";
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

      <Divider />
      <Text color={color.dim}>press q to exit</Text>
    </Box>
  );
}

const instance = render(<Viewer />, { alternateScreen: true });
await instance.waitUntilExit();
