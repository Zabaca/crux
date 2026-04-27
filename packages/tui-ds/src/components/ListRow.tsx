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
    <Box>
      <Text color={focused ? color.accent : undefined} bold={focused}>
        {focused ? "▶ " : "  "}
      </Text>
      <Box width={Math.min(slug.length, 24)} flexShrink={0}>
        <Text color={color.dim} wrap="truncate-end">
          {slug}
        </Text>
      </Box>
      <Text> </Text>
      {badges ? (
        <>
          <Box flexShrink={0}>{badges}</Box>
          <Text> </Text>
        </>
      ) : null}
      <Box flexShrink={1} flexGrow={1} minWidth={0}>
        <Text bold={focused} wrap="truncate-end">
          {title}
        </Text>
      </Box>
      {meta ? (
        <>
          <Text> </Text>
          <Box flexShrink={0}>
            <Text color={color.dim}>{meta}</Text>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
