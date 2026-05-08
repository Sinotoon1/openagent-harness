import { sanitizeForResponse } from "../security/sanitize.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import { mcpToolName } from "../constants/toolNames.js";
import {
  makeInvalidToolResponse,
  type IssueLike
} from "../validation/invalidResponse.js";

export const expectedShapes = {
  [mcpToolName.ossChat]:
    "{ modelId: canonicalModelId; sessionId: string; messages: ChatMessage[]; providerPriority?: ProviderId[]; capabilities?: CapabilityFlags; temperature?: number; maxTokens?: number; streaming?: { enabled?: boolean }; includeRawProviderResponse?: boolean; metadata?: object }",
  [mcpToolName.repairToolInput]:
    "{ modelId: canonicalModelId; input: unknown; sessionId?: string; schemaName?: oss_chat | readFile | writeFile | pathBatch; schemaDescriptor?: { toolName: string; schema: callerRepairSchema; pathStringFields?: string[]; pathStringArrayFields?: string[] }; provide exactly one of schemaName or schemaDescriptor }",
  [mcpToolName.compactContext]:
    "{ modelId: canonicalModelId; messages: ChatMessage[]; sessionId?: string; usedTokens?: nonnegative integer; inFlightTaskMessageIds?: string[] }",
  [mcpToolName.getModelPolicy]: "{ modelId?: canonicalModelId }",
  [mcpToolName.inspectModelPolicies]:
    "{ modelId?: string; includeProviders?: boolean; includeRepairs?: boolean; includeContext?: boolean; includeOverrides?: boolean; includeWarnings?: boolean }",
  [mcpToolName.runPolicyDoctor]:
    "{ modelId?: string; includeTelemetry?: boolean; includeProviderConfig?: boolean; includeSuggestions?: boolean; severity?: info | warning | error }",
  [mcpToolName.recordEvalEvent]:
    "{ eventName: string; sessionId?: string; modelId?: canonicalModelId; outcome?: pass | fail | skip | error; score?: number; metadata?: object }",
  [mcpToolName.queryTelemetry]:
    "{ type?: telemetryEventType; modelId?: canonicalModelId; providerId?: ProviderId; toolName?: string; sessionId?: string; limit?: 1..200; includeMetadata?: boolean }",
  [mcpToolName.getHarnessStats]:
    "{ modelId?: canonicalModelId; sessionId?: string; eventType?: string; limit?: 1..200; includeProviders?: boolean }",
  [mcpToolName.suggestRepairPolicy]: "{ modelId?: canonicalModelId }"
} as const;

export function asJsonText(data: unknown, isError = false) {
  const sanitized = sanitizeForResponse(data);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(sanitized, null, 2)
      }
    ],
    isError
  };
}

export function asPreSanitizedJsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

export function invalidToolInput(
  telemetry: TelemetrySink,
  toolName: string,
  issues: readonly IssueLike[],
  expectedShape: string
) {
  const response = makeInvalidToolResponse({
    toolName,
    issues,
    expectedShape
  });

  telemetry.record({
    type: telemetryEvent.toolInputInvalid,
    toolName,
    metadata: {
      issues: response.issues
    }
  });

  return asJsonText(response, true);
}

export function invalidToolInputWithoutTelemetry(
  toolName: string,
  issues: readonly IssueLike[],
  expectedShape: string
) {
  return asJsonText(
    makeInvalidToolResponse({
      toolName,
      issues,
      expectedShape
    }),
    true
  );
}
