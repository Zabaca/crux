import React from "react";
import { Box, Text } from "ink";
import { color, border } from "../tokens.js";

export type DetailPaneProps = {
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  children: React.ReactNode;
};

export function DetailPane({
  title,
  subtitle,
  badges,
  children,
}: DetailPaneProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle={border.panel} paddingX={2} paddingY={1}>
      <Box flexDirection="column">
        <Box>
          <Text bold wrap="wrap">
            {title}
          </Text>
        </Box>
        {subtitle ? (
          <Box>
            <Text color={color.dim}>{subtitle}</Text>
          </Box>
        ) : null}
        {badges ? <Box>{badges}</Box> : null}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}

export type DetailSectionProps = {
  label: string;
  children: React.ReactNode;
};

export function DetailSection({ label, children }: DetailSectionProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color.muted} bold>
        {label.toUpperCase()}
      </Text>
      <Text color={color.dim}>{"─".repeat(Math.max(label.length, 8))}</Text>
      <Box flexDirection="column" marginTop={0}>
        {children}
      </Box>
    </Box>
  );
}
