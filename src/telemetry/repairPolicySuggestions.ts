import { repairNames, type RepairName } from "../policies/types.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import type { TelemetryEvent } from "./types.js";

export type RepairPolicySuggestionConfidence = "low" | "medium" | "high";
export type RepairPolicySuggestionStatus =
  | "suggested"
  | "already_aligned"
  | "policy_not_found"
  | "insufficient_data";

export interface RepairPolicySuggestionWarning {
  code: string;
  message: string;
}

export interface ReviewableRepairPolicySuggestion {
  modelId: string;
  kind: "repair_order";
  status: RepairPolicySuggestionStatus;
  confidence: RepairPolicySuggestionConfidence;
  window: {
    type: "latest";
    limit: number;
    eventCount: number;
  };
  currentRepairs?: string[];
  suggestedRepairs: RepairName[];
  repairCounts: Partial<Record<RepairName, number>>;
  reason: string;
  yamlPatchPreview: string | null;
  warnings: RepairPolicySuggestionWarning[];
}

export interface ReviewableRepairPolicySuggestionOptions {
  modelId?: string;
  limit?: number;
  currentRepairsForModel?: (modelId: string) => string[] | undefined;
}

interface ModelRepairTelemetry {
  eventCount: number;
  repairCounts: Partial<Record<RepairName, number>>;
  unknownRepairCount: number;
}

const knownRepairNames = new Set<string>(repairNames);

export function createReviewableRepairPolicySuggestions(
  events: readonly TelemetryEvent[],
  options: ReviewableRepairPolicySuggestionOptions = {}
): ReviewableRepairPolicySuggestion[] {
  const limit = options.limit ?? 200;
  const byModel = groupRepairTelemetryByModel(events);

  if (options.modelId !== undefined && byModel[options.modelId] === undefined) {
    return [
      buildZeroEventPolicySuggestion(options.modelId, {
        limit,
        currentRepairsForModel: options.currentRepairsForModel
      })
    ];
  }

  return Object.entries(byModel)
    .filter(([modelId]) => options.modelId === undefined || modelId === options.modelId)
    .map(([modelId, telemetry]) =>
      buildModelPolicySuggestion(modelId, telemetry, {
        limit,
        currentRepairsForModel: options.currentRepairsForModel
      })
    );
}

function buildZeroEventPolicySuggestion(
  modelId: string,
  options: {
    limit: number;
    currentRepairsForModel?: (modelId: string) => string[] | undefined;
  }
): ReviewableRepairPolicySuggestion {
  const currentRepairs = options.currentRepairsForModel?.(modelId);
  const warnings: RepairPolicySuggestionWarning[] = [
    {
      code: "zero_repaired_telemetry_events",
      message:
        "No repaired telemetry events were found for this model in the bounded latest window."
    },
    {
      code: "bounded_latest_window",
      message: "Suggestion is based on the bounded latest telemetry window, not full history."
    },
    {
      code: "telemetry_sink_configured",
      message: "Telemetry may be in-memory or local JSONL depending on harness configuration."
    }
  ];

  if (currentRepairs === undefined) {
    warnings.push(
      {
        code: "current_policy_unavailable",
        message: "Current repair order is unavailable for this model."
      },
      {
        code: "model_policy_not_found",
        message: "Current model policy could not be loaded."
      }
    );
  }

  return {
    modelId,
    kind: "repair_order",
    status: "insufficient_data",
    confidence: "low",
    window: {
      type: "latest",
      limit: options.limit,
      eventCount: 0
    },
    ...(currentRepairs ? { currentRepairs } : {}),
    suggestedRepairs: [],
    repairCounts: {},
    reason:
      "No repaired telemetry events were available for this model, so no repair-order change is suggested.",
    yamlPatchPreview: null,
    warnings
  };
}

function groupRepairTelemetryByModel(
  events: readonly TelemetryEvent[]
): Record<string, ModelRepairTelemetry> {
  const byModel: Record<string, ModelRepairTelemetry> = {};

  for (const event of events) {
    if (event.type !== telemetryEvent.toolInputRepaired) {
      continue;
    }

    const modelId = event.modelId ?? "unknown";
    const model = (byModel[modelId] ??= {
      eventCount: 0,
      repairCounts: {},
      unknownRepairCount: 0
    });

    model.eventCount += 1;
    for (const repair of repairNamesFromEvent(event)) {
      if (isRepairName(repair)) {
        model.repairCounts[repair] = (model.repairCounts[repair] ?? 0) + 1;
      } else {
        model.unknownRepairCount += 1;
      }
    }
  }

  return byModel;
}

function buildModelPolicySuggestion(
  modelId: string,
  telemetry: ModelRepairTelemetry,
  options: {
    limit: number;
    currentRepairsForModel?: (modelId: string) => string[] | undefined;
  }
): ReviewableRepairPolicySuggestion {
  const currentRepairs = options.currentRepairsForModel?.(modelId);
  const suggestedRepairs = suggestedRepairOrder(telemetry.repairCounts, currentRepairs);
  const warnings = baseWarnings(telemetry, currentRepairs);
  const status = suggestionStatus(currentRepairs, suggestedRepairs);

  if (status === "already_aligned") {
    warnings.push({
      code: "suggested_order_unchanged",
      message: "Suggested repair order already matches the current model policy."
    });
  } else if (status === "policy_not_found") {
    warnings.push({
      code: "model_policy_not_found",
      message: "Current model policy could not be loaded; preview is a suggestion only."
    });
  }

  return {
    modelId,
    kind: "repair_order",
    status,
    confidence: confidenceForEventCount(telemetry.eventCount),
    window: {
      type: "latest",
      limit: options.limit,
      eventCount: telemetry.eventCount
    },
    ...(currentRepairs ? { currentRepairs } : {}),
    suggestedRepairs,
    repairCounts: telemetry.repairCounts,
    reason: reasonForSuggestion(status, telemetry.eventCount),
    yamlPatchPreview: yamlPatchPreview(modelId, suggestedRepairs, status),
    warnings
  };
}

function suggestedRepairOrder(
  repairCounts: Partial<Record<RepairName, number>>,
  currentRepairs: string[] | undefined
): RepairName[] {
  const currentSafeRepairs = (currentRepairs ?? []).filter(isRepairName);
  const observedSafeRepairs = repairNames.filter((repair) => (repairCounts[repair] ?? 0) > 0);
  const candidates = unique([...currentSafeRepairs, ...observedSafeRepairs]);

  return candidates.sort((left, right) => {
    const countDiff = (repairCounts[right] ?? 0) - (repairCounts[left] ?? 0);
    if (countDiff !== 0) {
      return countDiff;
    }

    const currentDiff =
      indexOrInfinity(currentSafeRepairs, left) - indexOrInfinity(currentSafeRepairs, right);
    if (currentDiff !== 0) {
      return currentDiff;
    }

    return repairNames.indexOf(left) - repairNames.indexOf(right);
  });
}

function baseWarnings(
  telemetry: ModelRepairTelemetry,
  currentRepairs: string[] | undefined
): RepairPolicySuggestionWarning[] {
  const warnings: RepairPolicySuggestionWarning[] = [
    {
      code: "bounded_latest_window",
      message: "Suggestion is based on the bounded latest telemetry window, not full history."
    },
    {
      code: "telemetry_sink_configured",
      message: "Telemetry may be in-memory or local JSONL depending on harness configuration."
    }
  ];

  if (telemetry.eventCount < 10) {
    warnings.push({
      code: "insufficient_telemetry_window",
      message: "Fewer than 10 repaired events were available for this model."
    });
  }

  if (telemetry.unknownRepairCount > 0) {
    warnings.push({
      code: "unknown_repair_names",
      message: `${telemetry.unknownRepairCount} unknown repair name(s) were ignored and excluded from the YAML preview.`
    });
  }

  if (currentRepairs === undefined) {
    warnings.push({
      code: "current_policy_unavailable",
      message: "Current repair order is unavailable for this model."
    });
  }

  return warnings;
}

function suggestionStatus(
  currentRepairs: string[] | undefined,
  suggestedRepairs: readonly RepairName[]
): RepairPolicySuggestionStatus {
  if (currentRepairs === undefined) {
    return "policy_not_found";
  }

  return arraysEqual(currentRepairs, suggestedRepairs) ? "already_aligned" : "suggested";
}

function confidenceForEventCount(eventCount: number): RepairPolicySuggestionConfidence {
  if (eventCount < 10) {
    return "low";
  }

  if (eventCount < 50) {
    return "medium";
  }

  return "high";
}

function reasonForSuggestion(status: RepairPolicySuggestionStatus, eventCount: number): string {
  if (status === "already_aligned") {
    return `The latest ${eventCount} repaired event(s) produce the same repair order as the current policy.`;
  }

  return `Repairs are ordered by observed frequency in the latest ${eventCount} repaired event(s). Review manually before editing YAML.`;
}

function yamlPatchPreview(
  modelId: string,
  suggestedRepairs: readonly RepairName[],
  status: RepairPolicySuggestionStatus
): string {
  const header = [
    "# Suggestion only; review manually before editing YAML.",
    `# Target policy: src/policies/${modelId}.yaml`
  ];

  if (status === "already_aligned") {
    header.push("# No YAML change is suggested because the repair order is already aligned.");
  }

  return [
    ...header,
    "repairs:",
    ...(suggestedRepairs.length > 0
      ? suggestedRepairs.map((repair) => `  - ${repair}`)
      : ["  # No known safe repairs observed in this telemetry window."])
  ].join("\n");
}

function repairNamesFromEvent(event: TelemetryEvent): string[] {
  const repairs = event.metadata?.repairs;
  if (Array.isArray(repairs)) {
    return repairs.filter((repair): repair is string => typeof repair === "string");
  }

  const notes = event.metadata?.notes;
  if (!Array.isArray(notes)) {
    return [];
  }

  return notes
    .map((note) => {
      if (!isRecord(note) || typeof note.code !== "string") {
        return undefined;
      }
      return note.code.replace(/^repair\./, "");
    })
    .filter((repair): repair is string => typeof repair === "string");
}

function isRepairName(value: unknown): value is RepairName {
  return typeof value === "string" && knownRepairNames.has(value);
}

function indexOrInfinity(values: readonly string[], value: string): number {
  const index = values.indexOf(value);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
