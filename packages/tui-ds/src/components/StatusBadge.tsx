import React from "react";
import { Text } from "ink";
import { color } from "../tokens.js";

export type StatusBadgeProps =
  | { variant: "lifecycle"; status: string }
  | { variant: "priority"; tier: string | null | undefined };

const lifecycleColors: Record<string, string> = {
  shaping: color.shaping,
  committed: color.committed,
  shipped: color.shipped,
  abandoned: color.abandoned,
};

const priorityColors: Record<string, string> = {
  P0: color.danger,
  P1: color.warning,
  P2: color.shaping,
  P3: color.dim,
};

export function StatusBadge(props: StatusBadgeProps): React.ReactElement {
  if (props.variant === "lifecycle") {
    const c = lifecycleColors[props.status] ?? "white";
    return (
      <Text color={c}>
        [<Text bold>{props.status}</Text>]
      </Text>
    );
  }

  // priority
  const tier = props.tier;
  if (tier == null) {
    return <Text color={color.dim}>[—]</Text>;
  }
  const c = priorityColors[tier] ?? "white";
  return (
    <Text color={c}>
      [<Text bold>{tier}</Text>]
    </Text>
  );
}
