import React, { useEffect, useRef, useState } from "react";
import { Box, useInput } from "ink";
import { ListRow } from "./ListRow.js";
import { EmptyState } from "./EmptyState.js";

export type ScrollableListItem = {
  slug: string;
  title: string;
  badges?: React.ReactNode;
  meta?: string;
};

export type ScrollableListProps = {
  items: ScrollableListItem[];
  onSelect: (item: ScrollableListItem, index: number) => void;
  onFocus?: (item: ScrollableListItem, index: number) => void;
  emptyMessage?: string;
};

export function ScrollableList({
  items,
  onSelect,
  onFocus,
  emptyMessage,
}: ScrollableListProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const lastFiredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (items.length === 0) {
      lastFiredKeyRef.current = null;
      return;
    }
    const idx = Math.min(selectedIndex, items.length - 1);
    const item = items[idx]!;
    const key = `${idx}:${item.slug}`;
    if (lastFiredKeyRef.current === key) return;
    lastFiredKeyRef.current = key;
    onFocusRef.current?.(item, idx);
  }, [selectedIndex, items]);

  useInput((_input, key) => {
    if (items.length === 0) return;
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (key.return) {
      const idx = Math.min(selectedIndex, items.length - 1);
      onSelect(items[idx]!, idx);
    }
  });

  if (items.length === 0) {
    if (emptyMessage) return <EmptyState>{emptyMessage}</EmptyState>;
    return <Box />;
  }

  return (
    <Box flexDirection="column" width="100%">
      {items.map((item, i) => (
        <ListRow
          key={`${item.slug}-${i}`}
          slug={item.slug}
          title={item.title}
          badges={item.badges}
          meta={item.meta}
          focused={i === selectedIndex}
        />
      ))}
    </Box>
  );
}
