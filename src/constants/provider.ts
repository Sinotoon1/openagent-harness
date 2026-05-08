export const stickySessionStrategy = {
  raw: "raw",
  hash: "hash"
} as const;

export const stickySessionStrategies = [
  stickySessionStrategy.raw,
  stickySessionStrategy.hash
] as const;

export type StickySessionStrategy = (typeof stickySessionStrategies)[number];
