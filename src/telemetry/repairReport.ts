import type { TelemetryEvent } from "./types.js";
import { repairNames, type RepairName } from "../policies/types.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";

export interface ModelRepairReport {
  totalRepairEvents: number;
  repairCounts: Partial<Record<RepairName, number>>;
  suggestedRepairOrder: RepairName[];
}

export interface RepairTelemetryReport {
  models: Record<string, ModelRepairReport>;
}

export function createRepairTelemetryReport(
  events: readonly TelemetryEvent[]
): RepairTelemetryReport {
  const models: Record<string, ModelRepairReport> = {};

  for (const event of events) {
    if (event.type !== telemetryEvent.toolInputRepaired) {
      continue;
    }

    const modelId = event.modelId ?? "unknown";
    const model = (models[modelId] ??= {
      totalRepairEvents: 0,
      repairCounts: {},
      suggestedRepairOrder: []
    });
    model.totalRepairEvents += 1;

    for (const repair of repairsFromEvent(event)) {
      model.repairCounts[repair] = (model.repairCounts[repair] ?? 0) + 1;
    }
  }

  for (const model of Object.values(models)) {
    model.suggestedRepairOrder = [...repairNames].sort((left, right) => {
      const countDiff = (model.repairCounts[right] ?? 0) - (model.repairCounts[left] ?? 0);
      return countDiff === 0 ? repairNames.indexOf(left) - repairNames.indexOf(right) : countDiff;
    });
  }

  return { models };
}

export function formatRepairTelemetryReport(report: RepairTelemetryReport): string {
  const entries = Object.entries(report.models);
  if (entries.length === 0) {
    return "No repair telemetry events found. Provide a JSON array of telemetry events to suggest per-model repair order.";
  }

  return entries
    .map(([modelId, model]) => {
      const counts = Object.entries(model.repairCounts)
        .map(([repair, count]) => `${repair}=${count}`)
        .join(", ");
      return [
        `Model: ${modelId}`,
        `Repair events: ${model.totalRepairEvents}`,
        `Repair counts: ${counts || "none"}`,
        `Suggested repair order: ${model.suggestedRepairOrder.join(", ")}`
      ].join("\n");
    })
    .join("\n\n");
}

function repairsFromEvent(event: TelemetryEvent): RepairName[] {
  const repairs = event.metadata?.repairs;
  if (Array.isArray(repairs)) {
    return repairs.filter(isRepairName);
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
    .filter(isRepairName);
}

function isRepairName(value: unknown): value is RepairName {
  return typeof value === "string" && repairNames.includes(value as RepairName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
