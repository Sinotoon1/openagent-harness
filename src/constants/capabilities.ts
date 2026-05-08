export const capabilityName = {
  zeroDataRetention: "zeroDataRetention",
  disallowPromptTraining: "disallowPromptTraining",
  thinking: "thinking"
} as const;

export const capabilityNames = [
  capabilityName.zeroDataRetention,
  capabilityName.disallowPromptTraining,
  capabilityName.thinking
] as const;

export type CapabilityName = (typeof capabilityNames)[number];
