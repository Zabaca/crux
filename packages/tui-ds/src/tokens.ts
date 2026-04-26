export const color = {
  // foreground
  muted: "gray",
  dim: "gray",
  accent: "#7C9CBF",
  success: "green",
  warning: "yellow",
  danger: "red",
  // status-specific
  shaping: "cyan",
  committed: "blue",
  shipped: "green",
  abandoned: "gray",
  proposed: "white",
  chosen: "green",
  rejected: "red",
  eliminated: "gray",
} as const;

export const border = {
  panel: "round",
  section: "single",
  box: "bold",
} as const;

export const space = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
} as const;
