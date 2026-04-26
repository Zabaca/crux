import React from "react";
import { Box } from "ink";
import { useTerminalSize } from "../hooks/index.js";

export type ScreenProps = {
  children: React.ReactNode;
  footer?: React.ReactNode;
  paddingX?: number;
};

export function Screen({ children, footer, paddingX = 1 }: ScreenProps): React.ReactElement {
  const { rows } = useTerminalSize();
  return (
    <Box flexDirection="column" height={rows} paddingX={paddingX}>
      <Box flexDirection="column" flexGrow={1}>
        {children}
      </Box>
      {footer ?? null}
    </Box>
  );
}
