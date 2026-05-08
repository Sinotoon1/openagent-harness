import { z } from "zod";
import { canonicalModelIds } from "../types.js";
import { repairNames } from "../constants/repairNames.js";
import type { RepairName } from "../constants/repairNames.js";
export { repairNames, type RepairName } from "../constants/repairNames.js";

export const providerThinkingOverrideValues = [
  "enabled",
  "disabled",
  "unchanged"
] as const;

export const providerOverrideSchema = z
  .object({
    providerId: z.string().min(1),
    thinking: z.enum(providerThinkingOverrideValues),
    reason: z.string().min(1).optional()
  })
  .strict();

export const modelPolicySchema = z.object({
  modelId: z.enum(canonicalModelIds),
  repairs: z.array(z.enum(repairNames)),
  effectiveContextTokens: z.number().int().positive(),
  providerOverrides: z.array(providerOverrideSchema).optional()
}).strict();

export type ProviderThinkingOverride = (typeof providerThinkingOverrideValues)[number];
export type ProviderModelOverride = z.infer<typeof providerOverrideSchema>;
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
