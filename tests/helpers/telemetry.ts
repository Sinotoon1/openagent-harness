import { InMemoryTelemetrySink } from "../../src/telemetry/memory.js";

export function recordRepairEvents(
  telemetry: InMemoryTelemetrySink,
  modelId: string,
  repairs: string[],
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    telemetry.record({
      type: "tool_input_repaired",
      modelId: modelId as never,
      toolName: "repair_tool_input",
      metadata: {
        repairs
      }
    });
  }
}

export function confidenceFor(
  suggestions: Array<{ modelId: string; confidence: string }>,
  modelId: string
): string | undefined {
  return suggestions.find((suggestion) => suggestion.modelId === modelId)?.confidence;
}
