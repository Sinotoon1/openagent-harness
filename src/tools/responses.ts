import { sanitizeForResponse } from "../security/sanitize.js";
import type { TelemetrySink } from "../telemetry/types.js";
import {
  makeInvalidToolResponse,
  type IssueLike
} from "../validation/invalidResponse.js";

export const expectedShapes = {
  oss_chat:
    "{ modelId: canonicalModelId; sessionId: string; messages: ChatMessage[]; providerPriority?: ProviderId[]; capabilities?: CapabilityFlags; temperature?: number; maxTokens?: number; streaming?: { enabled?: boolean }; includeRawProviderResponse?: boolean; metadata?: object }",
  repair_tool_input:
    "{ modelId: canonicalModelId; input: unknown; sessionId?: string; schemaName?: oss_chat | readFile | writeFile | pathBatch; schemaDescriptor?: { toolName: string; schema: callerRepairSchema; pathStringFields?: string[]; pathStringArrayFields?: string[] }; provide exactly one of schemaName or schemaDescriptor }",
  compact_context:
    "{ modelId: canonicalModelId; messages: ChatMessage[]; sessionId?: string; usedTokens?: nonnegative integer; inFlightTaskMessageIds?: string[] }",
  get_model_policy: "{ modelId?: canonicalModelId }",
  inspect_model_policies:
    "{ modelId?: string; includeProviders?: boolean; includeRepairs?: boolean; includeContext?: boolean; includeOverrides?: boolean; includeWarnings?: boolean }",
  run_policy_doctor:
    "{ modelId?: string; includeTelemetry?: boolean; includeProviderConfig?: boolean; includeSuggestions?: boolean; severity?: info | warning | error }",
  record_eval_event:
    "{ eventName: string; sessionId?: string; modelId?: canonicalModelId; outcome?: pass | fail | skip | error; score?: number; metadata?: object }",
  query_telemetry:
    "{ type?: telemetryEventType; modelId?: canonicalModelId; providerId?: ProviderId; toolName?: string; sessionId?: string; limit?: 1..200; includeMetadata?: boolean }",
  get_harness_stats:
    "{ modelId?: canonicalModelId; sessionId?: string; eventType?: string; limit?: 1..200; includeProviders?: boolean }",
  suggest_repair_policy: "{ modelId?: canonicalModelId }"
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
    type: "tool_input_invalid",
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
