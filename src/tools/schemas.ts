import { z } from "zod";
import { canonicalModelIds, providerIds } from "../types.js";
import { telemetryEventTypes } from "../telemetry/types.js";
import {
  chatMessageSchema,
  ossChatInputSchema,
  repairSchemaNames
} from "../repair/schemaSpecs.js";

export { ossChatInputSchema };

export const repairToolInputSchema = z
  .object({
    modelId: z.enum(canonicalModelIds),
    sessionId: z.string().optional(),
    schemaName: z.enum(repairSchemaNames),
    input: z.unknown()
  })
  .strict();

export const compactContextInputSchema = z
  .object({
    modelId: z.enum(canonicalModelIds),
    sessionId: z.string().optional(),
    messages: z.array(chatMessageSchema),
    usedTokens: z.number().int().nonnegative().optional(),
    inFlightTaskMessageIds: z.array(z.string()).optional()
  })
  .strict();

export const getModelPolicyInputSchema = z
  .object({
    modelId: z.enum(canonicalModelIds).optional()
  })
  .strict();

export const recordEvalEventInputSchema = z
  .object({
    sessionId: z.string().optional(),
    modelId: z.enum(canonicalModelIds).optional(),
    eventName: z.string().min(1),
    outcome: z.enum(["pass", "fail", "skip", "error"]).optional(),
    score: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const queryTelemetryInputSchema = z
  .object({
    type: z.enum(telemetryEventTypes).optional(),
    modelId: z.enum(canonicalModelIds).optional(),
    providerId: z.enum(providerIds).optional(),
    toolName: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    includeMetadata: z.boolean().optional()
  })
  .strict();

export const suggestRepairPolicyInputSchema = z
  .object({
    modelId: z.enum(canonicalModelIds).optional()
  })
  .strict();
