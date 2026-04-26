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
      <Text bold>{title}</Text>
      {subtitle ? <Text color={color.dim}>{subtitle}</Text> : null}
      {badges ? <Box marginTop={subtitle ? 0 : 0}>{badges}</Box> : null}
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
