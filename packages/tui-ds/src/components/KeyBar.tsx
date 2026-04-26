import React from "react";
import { Text } from "ink";
import { color } from "../tokens.js";

export type KeyHint = { key: string; label: string };

export type KeyBarProps = {
  hints: KeyHint[];
};

export function KeyBar({ hints }: KeyBarProps): React.ReactElement {
  const parts: React.ReactNode[] = [];
  hints.forEach((hint, i) => {
    if (i > 0) {
      parts.push(
        <Text key={`sep-${i}`} color={color.dim}>
          {" · "}
        </Text>,
      );
    }
    parts.push(
      <Text key={`key-${i}`} bold color="white">
        {hint.key}
      </Text>,
    );
    parts.push(<Text key={`gap-${i}`}> </Text>);
    parts.push(
      <Text key={`label-${i}`} color={color.dim}>
        {hint.label}
      </Text>,
    );
  });
  return <Text color={color.dim}>{parts}</Text>;
}
