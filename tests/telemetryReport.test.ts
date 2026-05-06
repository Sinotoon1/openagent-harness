import { describe, expect, it } from "vitest";
import {
  createRepairTelemetryReport,
  formatRepairTelemetryReport
} from "../src/telemetry/repairReport.js";
import type { TelemetryEvent } from "../src/telemetry/types.js";

describe("repair telemetry report", () => {
  it("aggregates repairs by model and suggests frequency order", () => {
    const events: TelemetryEvent[] = [
      {
        type: "tool_input_repaired",
        timestamp: "2026-05-06T00:00:00.000Z",
        modelId: "deepseek-v4-pro",
        metadata: {
          repairs: ["bareStringToArray", "parseJsonArrayString", "bareStringToArray"]
        }
      },
      {
        type: "tool_input_repaired",
        timestamp: "2026-05-06T00:00:01.000Z",
        modelId: "kimi-k2-6",
        metadata: {
          notes: [{ code: "repair.emptyObjectToArray" }]
        }
      }
    ];

    const report = createRepairTelemetryReport(events);

    expect(report.models["deepseek-v4-pro"]?.repairCounts).toMatchObject({
      bareStringToArray: 2,
      parseJsonArrayString: 1
    });
    expect(report.models["deepseek-v4-pro"]?.suggestedRepairOrder[0]).toBe(
      "bareStringToArray"
    );
    expect(report.models["kimi-k2-6"]?.repairCounts).toMatchObject({
      emptyObjectToArray: 1
    });
    expect(formatRepairTelemetryReport(report)).toContain("Suggested repair order:");
  });
});
