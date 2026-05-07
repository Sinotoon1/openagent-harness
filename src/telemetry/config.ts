import { JsonlTelemetrySink } from "./jsonl.js";
import { MemoryTelemetrySink } from "./memory.js";
import type { TelemetrySink } from "./types.js";

export type TelemetrySinkKind = "memory" | "jsonl";

export function createTelemetrySinkFromEnv(
  env: NodeJS.ProcessEnv = process.env
): TelemetrySink {
  const sinkKind = env.OSS_HARNESS_TELEMETRY_SINK ?? "memory";

  if (sinkKind === "memory") {
    return new MemoryTelemetrySink();
  }

  if (sinkKind === "jsonl") {
    const jsonlPath = env.OSS_HARNESS_TELEMETRY_JSONL_PATH;
    if (!jsonlPath) {
      throw new Error(
        "OSS_HARNESS_TELEMETRY_JSONL_PATH is required when OSS_HARNESS_TELEMETRY_SINK=jsonl"
      );
    }

    return new JsonlTelemetrySink(jsonlPath);
  }

  throw new Error("OSS_HARNESS_TELEMETRY_SINK must be memory or jsonl");
}
