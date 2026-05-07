import { canonicalModelIds, providerIds } from "../types.js";
import type { TelemetryEventType } from "./types.js";
import { queryTelemetry, type TelemetryQueryResult } from "./query.js";
import type { TelemetrySink } from "./types.js";

const knownToolNames = new Set([
  "oss_chat",
  "repair_tool_input",
  "compact_context",
  "get_model_policy",
  "inspect_model_policies",
  "record_eval_event",
  "query_telemetry",
  "get_harness_stats",
  "suggest_repair_policy",
  "readFile",
  "writeFile",
  "pathBatch"
]);

const knownRepairNames = new Set([
  "stripNullOptional",
  "emptyObjectToArray",
  "parseJsonArrayString",
  "bareStringToArray",
  "markdownPathAutolinkUnwrap"
]);

const contextModes = new Set([
  "drop_dead_tool_calls",
  "aggressive_drop",
  "summarize_old_context"
]);

const fallbackPhases = new Set(["before_first_token", "after_first_token"]);

export interface HarnessStatsInput {
  modelId?: string;
  sessionId?: string;
  eventType?: string;
  limit?: number;
  includeProviders?: boolean;
}

export interface HarnessStats {
  window: {
    type: "latest";
    limit: number;
  };
  totals: {
    events: number;
    models: number;
    providers: number;
  };
  toolInputs: {
    invalid: number;
    repaired: number;
    normalized: number;
    repairSuccessRate: number;
  };
  repairs: {
    byModel: Record<string, number>;
    byRepair: Record<string, number>;
    byTool: Record<string, number>;
  };
  routing: {
    fallbacks: number;
    byProvider: Record<string, number>;
    byPhase: Record<string, number>;
  };
  streaming: {
    success: number;
    failuresBeforeFirstToken: number;
    failuresAfterFirstToken: number;
    malformed: number;
    empty: number;
    incomplete: number;
  };
  cache: {
    likelyWarm: number;
    likelyCold: number;
    warmRate: number;
  };
  context: {
    compactions: number;
    byMode: Record<string, number>;
  };
  caveats: string[];
}

export function getHarnessStats(
  telemetry: TelemetrySink,
  input: HarnessStatsInput = {}
): HarnessStats {
  const limit = clampLimit(input.limit);
  const includeProviders = input.includeProviders ?? true;
  const telemetryResult = queryTelemetry(telemetry, {
    type: input.eventType as TelemetryEventType | undefined,
    modelId: input.modelId,
    sessionId: input.sessionId,
    limit,
    includeMetadata: true
  });

  return summarizeTelemetryWindow(telemetryResult, {
    limit,
    includeProviders
  });
}

function summarizeTelemetryWindow(
  telemetryResult: TelemetryQueryResult,
  options: { limit: number; includeProviders: boolean }
): HarnessStats {
  const modelIds = new Set<string>();
  const providerIdsInWindow = new Set<string>();
  const repairsByModel: Record<string, number> = {};
  const repairsByRepair: Record<string, number> = {};
  const repairsByTool: Record<string, number> = {};
  const routingByProvider: Record<string, number> = {};
  const routingByPhase: Record<string, number> = {};
  const contextByMode: Record<string, number> = {};

  let invalid = 0;
  let repaired = 0;
  let normalized = 0;
  let fallbacks = 0;
  let streamingSuccess = 0;
  let failuresBeforeFirstToken = 0;
  let failuresAfterFirstToken = 0;
  let malformed = 0;
  let empty = 0;
  let incomplete = 0;
  let likelyWarm = 0;
  let likelyCold = 0;
  let compactions = 0;

  for (const event of telemetryResult.events) {
    const modelId = safeModelId(event.modelId);
    const providerId = safeProviderId(event.providerId);
    const metadata = event.metadata ?? {};

    if (modelId) {
      modelIds.add(modelId);
    }
    if (options.includeProviders && providerId) {
      providerIdsInWindow.add(providerId);
    }

    switch (event.type) {
      case "tool_input_invalid":
        invalid += 1;
        break;
      case "tool_input_repaired":
        repaired += 1;
        increment(repairsByModel, modelId ?? "<unknown>");
        increment(repairsByTool, safeToolName(event.toolName));
        for (const repair of safeRepairNames(metadata)) {
          increment(repairsByRepair, repair);
        }
        break;
      case "tool_input_normalized":
        normalized += 1;
        break;
      case "provider_fallback": {
        fallbacks += 1;
        const phase = safeFallbackPhase(metadata.fallbackPhase);
        if (options.includeProviders) {
          increment(routingByProvider, providerId ?? safeProviderId(metadata.fromProvider) ?? "<unknown>");
        }
        increment(routingByPhase, phaseKey(phase));
        if (phase === "before_first_token") {
          failuresBeforeFirstToken += 1;
        } else if (phase === "after_first_token") {
          failuresAfterFirstToken += 1;
        }
        break;
      }
      case "cache_likely_warm":
        likelyWarm += 1;
        break;
      case "cache_likely_cold":
        likelyCold += 1;
        break;
      case "context_compacted": {
        compactions += 1;
        increment(contextByMode, safeContextMode(metadata.strategy));
        break;
      }
      default:
        break;
    }

    const streaming = classifyStreaming(metadata);
    streamingSuccess += streaming.success;
    malformed += streaming.malformed;
    empty += streaming.empty;
    incomplete += streaming.incomplete;
    failuresBeforeFirstToken += streaming.failuresBeforeFirstToken;
    failuresAfterFirstToken += streaming.failuresAfterFirstToken;
  }

  return {
    window: {
      type: "latest",
      limit: options.limit
    },
    totals: {
      events: telemetryResult.returned,
      models: modelIds.size,
      providers: providerIdsInWindow.size
    },
    toolInputs: {
      invalid,
      repaired,
      normalized,
      repairSuccessRate: rate(repaired, invalid)
    },
    repairs: {
      byModel: repairsByModel,
      byRepair: repairsByRepair,
      byTool: repairsByTool
    },
    routing: {
      fallbacks,
      byProvider: routingByProvider,
      byPhase: routingByPhase
    },
    streaming: {
      success: streamingSuccess,
      failuresBeforeFirstToken,
      failuresAfterFirstToken,
      malformed,
      empty,
      incomplete
    },
    cache: {
      likelyWarm,
      likelyCold,
      warmRate: rate(likelyWarm, likelyWarm + likelyCold)
    },
    context: {
      compactions,
      byMode: contextByMode
    },
    caveats: [
      "telemetry may be in-memory or local JSONL depending on configuration",
      "stats are based on the bounded latest telemetry window"
    ]
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 200;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 200);
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function safeModelId(value: unknown): string | undefined {
  return typeof value === "string" && (canonicalModelIds as readonly string[]).includes(value)
    ? value
    : undefined;
}

function safeProviderId(value: unknown): string | undefined {
  return typeof value === "string" && (providerIds as readonly string[]).includes(value)
    ? value
    : undefined;
}

function safeToolName(value: unknown): string {
  return typeof value === "string" && knownToolNames.has(value) ? value : "<other>";
}

function safeRepairNames(metadata: Record<string, unknown>): string[] {
  const repairs = metadata.repairs;
  if (!Array.isArray(repairs)) {
    return [];
  }

  return repairs.map((repair) =>
    typeof repair === "string" && knownRepairNames.has(repair) ? repair : "<other>"
  );
}

function safeFallbackPhase(value: unknown): string {
  return typeof value === "string" && fallbackPhases.has(value) ? value : "<unknown>";
}

function phaseKey(phase: string): string {
  if (phase === "before_first_token") {
    return "beforeFirstToken";
  }
  if (phase === "after_first_token") {
    return "afterFirstToken";
  }
  return "<unknown>";
}

function safeContextMode(value: unknown): string {
  return typeof value === "string" && contextModes.has(value) ? value : "<unknown>";
}

function classifyStreaming(metadata: Record<string, unknown>) {
  const status = stringValue(
    metadata.streamingStatus ?? metadata.streamStatus ?? metadata.status ?? metadata.outcome
  );
  const fallbackPhase = safeFallbackPhase(metadata.fallbackPhase);

  return {
    success: metadata.streamingSuccess === true || status === "streaming_success" || status === "success" ? 1 : 0,
    failuresBeforeFirstToken:
      metadata.streamingFailure === true && fallbackPhase === "before_first_token" ? 1 : 0,
    failuresAfterFirstToken:
      metadata.streamingFailure === true && fallbackPhase === "after_first_token" ? 1 : 0,
    malformed: metadata.malformed === true || status === "malformed" ? 1 : 0,
    empty: metadata.empty === true || status === "empty" ? 1 : 0,
    incomplete: metadata.incomplete === true || status === "incomplete" ? 1 : 0
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
