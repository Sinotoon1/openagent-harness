import { z } from "zod";
import { canonicalModelIds, providerIds } from "../types.js";

export const capabilityFlagsSchema = z
  .object({
    zeroDataRetention: z.boolean().optional(),
    disallowPromptTraining: z.boolean().optional(),
    thinking: z.boolean().optional()
  })
  .strict();

export const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    id: z.string().optional(),
    status: z.enum(["live", "dead", "in_flight"]).optional(),
    toolName: z.string().optional(),
    createdAt: z.string().optional()
  })
  .strict();

export const pathStringSchema = z
  .string()
  .min(1)
  .refine((value) => !isDegenerateMarkdownPathAutolink(value), {
    message: "Expected a plain path string, not a markdown auto-link."
  });

export const ossChatInputSchema = z
  .object({
    modelId: z.enum(canonicalModelIds),
    sessionId: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    providerPriority: z.array(z.enum(providerIds)).optional(),
    capabilities: capabilityFlagsSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    streaming: z
      .object({
        enabled: z.boolean().optional()
      })
      .strict()
      .optional(),
    includeRawProviderResponse: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const readFileInputSchema = z
  .object({
    pathString: pathStringSchema,
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    reason: z.string().optional()
  })
  .strict();

export const writeFileInputSchema = z
  .object({
    pathString: pathStringSchema,
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const pathBatchInputSchema = z
  .object({
    paths: z.array(pathStringSchema),
    optionalPaths: z.array(pathStringSchema).optional(),
    label: z.string().optional()
  })
  .strict();

export const repairSchemaNames = ["oss_chat", "readFile", "writeFile", "pathBatch"] as const;

export type RepairSchemaName = (typeof repairSchemaNames)[number];

export interface RepairSchemaSpec {
  name: string;
  schema: z.ZodType<unknown>;
  arrayFields: string[];
  optionalFields: string[];
  pathStringFields: string[];
  pathStringArrayFields: string[];
  expectedShape: string;
}

export const repairSchemaSpecs: Record<RepairSchemaName, RepairSchemaSpec> = {
  oss_chat: {
    name: "oss_chat",
    schema: ossChatInputSchema,
    arrayFields: ["messages", "providerPriority"],
    optionalFields: [
      "providerPriority",
      "capabilities",
      "temperature",
      "maxTokens",
      "streaming",
      "includeRawProviderResponse",
      "metadata"
    ],
    pathStringFields: [],
    pathStringArrayFields: [],
    expectedShape:
      "{ modelId: canonicalModelId; sessionId: string; messages: ChatMessage[]; providerPriority?: ProviderId[]; capabilities?: CapabilityFlags; temperature?: number; maxTokens?: number; streaming?: { enabled?: boolean }; includeRawProviderResponse?: boolean; metadata?: object }"
  },
  readFile: {
    name: "readFile",
    schema: readFileInputSchema,
    arrayFields: [],
    optionalFields: ["limit", "offset", "reason"],
    pathStringFields: ["pathString"],
    pathStringArrayFields: [],
    expectedShape: "{ pathString: plain path string; limit?: positive integer; offset?: nonnegative integer; reason?: string }"
  },
  writeFile: {
    name: "writeFile",
    schema: writeFileInputSchema,
    arrayFields: [],
    optionalFields: ["metadata"],
    pathStringFields: ["pathString"],
    pathStringArrayFields: [],
    expectedShape: "{ pathString: plain path string; content: string; metadata?: object }"
  },
  pathBatch: {
    name: "pathBatch",
    schema: pathBatchInputSchema,
    arrayFields: ["paths", "optionalPaths"],
    optionalFields: ["optionalPaths", "label"],
    pathStringFields: [],
    pathStringArrayFields: ["paths", "optionalPaths"],
    expectedShape: "{ paths: plain path string[]; optionalPaths?: plain path string[]; label?: string }"
  }
};

export function isDegenerateMarkdownPathAutolink(value: string): boolean {
  const markdownLink = value.match(/^\[([^\]]+)]\(([^)]+)\)$/);
  if (markdownLink && markdownLink[1] === markdownLink[2]) {
    return true;
  }

  return /^<([^<>\n]+)>$/.test(value);
}
