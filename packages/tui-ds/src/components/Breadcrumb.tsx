import React from "react";
import { Text } from "ink";
import { color } from "../tokens.js";

export type BreadcrumbItem = { label: string };
export type BreadcrumbProps = { items: BreadcrumbItem[] };

export function Breadcrumb({ items }: BreadcrumbProps): React.ReactElement {
  const parts: React.ReactNode[] = [];
  items.forEach((item, i) => {
    if (i > 0) {
      parts.push(
        <Text key={`sep-${i}`} color={color.dim}>
          {" › "}
        </Text>,
      );
    }
    const isLast = i === items.length - 1;
    parts.push(
      <Text key={`item-${i}`} color={isLast ? "white" : color.dim}>
        {item.label}
      </Text>,
    );
  });
  return <Text wrap="truncate-end">{parts}</Text>;
}
