import { z } from "zod";
import { canonicalModelIds } from "../types.js";

export const repairNames = [
  "emptyObjectToArray",
  "parseJsonArrayString",
  "bareStringToArray",
  "stripNullOptional",
  "markdownPathAutolinkUnwrap"
] as const;

export type RepairName = (typeof repairNames)[number];

export const modelPolicySchema = z.object({
  modelId: z.enum(canonicalModelIds),
  repairs: z.array(z.enum(repairNames)),
  effectiveContextTokens: z.number().int().positive()
});

export type ModelPolicy = z.infer<typeof modelPolicySchema>;
