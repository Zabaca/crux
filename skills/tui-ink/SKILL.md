---
name: tui-ink
description: Layout, truncation, and rendering patterns for the Crux Ink/React TUI and the `@crux/tui-ds` design system. Use when adding a new screen, building or modifying a TUI component, debugging visual glitches (text wrapping, overlapping rows, "second-line" gaps), or extending the design system. This is a living document — when you discover a new Ink/Yoga quirk or land a layout fix, append a note here so the next session doesn't re-learn it.
---

# tui-ink

Ink renders React components to a terminal using Facebook's Yoga flex engine. It looks like the web, but the layout primitives are different in subtle ways — and most "weird rendering" bugs in Crux's TUI trace back to Yoga quirks rather than React mistakes.

This skill is the project's accumulated layout knowledge. **Update it when you fix a non-obvious layout bug.** "Three lines on the same screen line", "text bleeding into the next row", "row not truncating" — those are the kinds of fixes worth a paragraph here. The cost of one extra paragraph now is much less than the next agent re-deriving it from scratch.

## Where the design system lives

- `packages/tui-ds/src/components/` — primitives (`Screen`, `DetailPane`, `DetailSection`, `ListRow`, `ScrollableList`, `KeyBar`, `Breadcrumb`, `StatusBadge`, `EmptyState`)
- `packages/tui-ds/src/screens/` — full-screen fixtures (`WorkstreamDashboard`, `ProblemDetail`) used by the viewer to iterate on layout with realistic data
- `packages/tui-ds/src/hooks/` — reactive helpers (`useTerminalSize`)
- `packages/tui-ds/src/tokens.ts` — `color`, `border`, `space` constants
- `packages/tui-ds/src/viewer.tsx` — paginated viewer; `bun run dev` from `packages/tui-ds/` for live iteration
- `packages/cli/src/browse/` — the real app; consumes the design system

## Core rules

### 1. Always use the design system

Before reaching for raw `<Box>` and `<Text>` for headers, list rows, panes, or footers, look in `packages/tui-ds/src/components/`. If a primitive almost-fits, extend the primitive — don't fork a one-off in the views.

### 2. `useTerminalSize`, not `process.stdout.rows`

`process.stdout.rows` reads once at component mount and stays stale on resize. Always use the `useTerminalSize` hook from `@crux/tui-ds/hooks` so layouts react when the user resizes their terminal.

```tsx
const { rows } = useTerminalSize();
return <Box height={rows}>...</Box>;
```

### 3. `Screen` for full-page layouts

`Screen` (in tui-ds) handles the root `height={rows}` + `flexGrow={1}` content area + sticky footer pattern. Wrap views in it; don't reimplement the height plumbing per-screen.

```tsx
<Screen footer={<KeyBar hints={hints} />}>
  {body}
</Screen>
```

### 4. `alternateScreen: true` on render

When mounting an Ink app at the top level, pass `{ alternateScreen: true }` to `render()`. This clears the terminal cleanly and restores it on exit — without it the output bleeds into the user's scrollback.

## Yoga / Ink layout quirks (field-tested)

These are the ones that have actually bitten us. Add to this list when you find new ones.

### Multiple `<Text>` siblings in a column Box can merge

In a `<Box flexDirection="column">`, consecutive `<Text>` children sometimes render on the same visual line. Yoga can compute a Box wrapping a single `<Text>` as 0-height, which puts the next sibling at the same Y position — visually overwriting the first.

**Symptoms:** subtitle text and badges appear on the same line, overlapping (`[shaping] [P2]irectional-sync` instead of separate lines for slug and badges).

**Fix:** Don't try to stack 3+ inline-text elements with separate Boxes. Either merge logically-related items into one row Box, or use `marginTop` to force vertical separation between groups.

### Text truncation needs an explicit width or `minWidth={0}`

`wrap="truncate-end"` on a `<Text>` only kicks in when its parent's width is bounded. In nested layouts (e.g., a `ScrollableList` inside a `DetailPane` inside a `Screen`), the width constraint can fail to propagate, and the text overflows instead of truncating.

**Fix for variable-length labels (slugs):** wrap in a Box with an explicit cap:
```tsx
<Box width={Math.min(slug.length, 24)} flexShrink={0}>
  <Text wrap="truncate-end">{slug}</Text>
</Box>
```

**Fix for flex-grow titles:** add `minWidth={0}` to the flex-grow container. Without it Yoga uses the content's natural width as the minimum, defeating shrinking:
```tsx
<Box flexShrink={1} flexGrow={1} minWidth={0}>
  <Text wrap="truncate-end">{title}</Text>
</Box>
```

This is the standard CSS flexbox trick for text truncation in flex containers; same logic applies in Yoga.

### Avoid `width="100%"` on children of bordered boxes

Percentage widths on children of a bordered/padded Box don't always resolve correctly. Default flex stretch (no explicit width) usually does the right thing.

### `flexShrink` in column containers can affect cross-axis width

Setting `flexShrink` on a child of a `flexDirection="column"` Box can unexpectedly shrink its WIDTH (the cross axis). If a column-child's width is collapsing without an obvious reason, remove `flexShrink`.

### Height constraint + overflowing content = mangled layout

If the root Box has `height={rows}` and the rendered content exceeds that height, Yoga can collapse inner Boxes and merge text nodes. Either use a paginator (single visible section at a time, like the viewer does) or ensure content fits.

### `renderToString` diverges from the real terminal

`ink`'s `renderToString(element, { columns })` is useful for layout-logic debugging but **not pixel-accurate** when percentage widths are involved. Always verify in a real terminal before declaring a layout fixed.

## Component-specific gotchas

### `ListRow`

- Slug column is capped at 24 chars via `width={Math.min(slug.length, 24)}`. Long real-world slugs (30+ chars) used to push meta text onto a second line.
- Title flex Box needs `minWidth={0}` to truncate inside `DetailPane` / nested layouts.

### `ScrollableList`

- Owns `selectedIndex` state and `useInput` for ↑↓/Enter.
- `isFocused` prop (default `true`) gates input — required when multiple `ScrollableList` instances exist on the same screen, because Ink's `useInput` is global. Two un-gated lists move together.
- `onFocus(item, index)` fires on selection change including mount; `onSelect(item, index)` on Enter.

### `DetailPane`

- Title is rendered above; subtitle and badges share a single row below the title (this is intentional after fighting the column-Text-merge bug — see above).
- `DetailSection` is a labeled sub-block inside a `DetailPane`. Use sections, not raw bordered sub-boxes.

### `KeyBar`

- Pure inline `<Text>`; no border. Pin to the bottom via `Screen`'s `footer` slot, not via inline rendering inside views.

## ink-select-input

`ink-select-input`'s flat padded string labels can't truncate cleanly inside a column with limited width — they wrap. **Replace with `ScrollableList` + `ListRow`** when laying out anything beyond a trivial picker.

## Multi-section focus

When a screen has multiple `ScrollableList` instances (e.g., evidence + solutions in `ProblemDetailView`):
1. Track an `activeSection` state in the parent.
2. Pass `isFocused={activeSection === "x"}` to each list.
3. Use a key (e.g., Tab) to flip the active section in `useInput`.
4. Surface the binding in the screen's `KeyBar` hints.

## Iteration workflow

The fastest way to debug a layout is the design-system viewer:

```sh
cd packages/tui-ds && bun run dev    # auto-reloads on save
```

Build the broken case as a static fixture in `src/screens/` with realistic data, iterate until it looks right in the viewer, then port to the real view.

For the real app:
```sh
cd packages/cli && bun run browse:dev
```

Both use `bun --watch` so file edits restart immediately.

## When you fix a layout bug

After landing a non-obvious fix, ask:
- Was the Yoga/Ink behavior surprising?
- Could the next agent re-derive it in <5 min from the codebase?

If the answer is "yes, surprising" and "no, would take a while" — append a paragraph to the relevant section above. One sentence stating the symptom, one stating the fix, one stating *why*. Future-you will thank present-you.
