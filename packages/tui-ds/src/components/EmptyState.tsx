import React from "react";
import { Box, Text } from "ink";
import { color } from "../tokens.js";

export type EmptyStateProps = { children: React.ReactNode };

export function EmptyState({ children }: EmptyStateProps): React.ReactElement {
  return (
    <Box justifyContent="center" paddingY={1} width="100%">
      <Text color={color.dim}>{children}</Text>
    </Box>
  );
}
