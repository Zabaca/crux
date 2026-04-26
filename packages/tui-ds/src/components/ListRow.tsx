import React from "react";
import { Box, Text } from "ink";
import { color } from "../tokens.js";

export type ListRowProps = {
  slug: string;
  title: string;
  focused?: boolean;
  badges?: React.ReactNode;
  meta?: string;
};

export function ListRow({
  slug,
  title,
  focused = false,
  badges,
  meta,
}: ListRowProps): React.ReactElement {
  return (
    <Box width="100%">
      {focused ? (
        <Text color={color.accent} bold>
          {"▶ "}
        </Text>
      ) : (
        <Text>{"  "}</Text>
      )}
      <Text color={color.dim}>{slug}</Text>
      <Text> </Text>
      {badges ? (
        <>
          <Box>{badges}</Box>
          <Text> </Text>
        </>
      ) : null}
      <Box flexShrink={1}>
        <Text bold={focused} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      <Box flexGrow={1} />
      {meta ? <Text color={color.dim}>{meta}</Text> : null}
    </Box>
  );
}
