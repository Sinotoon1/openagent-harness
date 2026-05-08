export const fallbackPhase = {
  beforeFirstToken: "before_first_token",
  afterFirstToken: "after_first_token"
} as const;

export const fallbackPhases = [
  fallbackPhase.beforeFirstToken,
  fallbackPhase.afterFirstToken
] as const;

export type FallbackPhase = (typeof fallbackPhases)[number];
