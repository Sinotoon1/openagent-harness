import type {
  CanonicalModelId,
  CapabilityName,
  ProviderId
} from "../types.js";

export const telemetryEventTypes = [
  "provider_fallback",
  "tool_input_repaired",
  "tool_input_normalized",
  "tool_input_invalid",
  "capability_dropped",
  "capability_negotiated",
  "thinking_overridden",
  "cache_likely_warm",
  "cache_likely_cold",
  "context_compacted",
  "eval_event_recorded"
] as const;

export type TelemetryEventType = (typeof telemetryEventTypes)[number];

export interface TelemetryEvent {
  type: TelemetryEventType;
  timestamp: string;
  sessionId?: string;
  sessionIdHash?: string;
  modelId?: CanonicalModelId;
  providerId?: ProviderId;
  capability?: CapabilityName;
  toolName?: string;
  metadata?: Record<string, unknown>;
}

export interface TelemetryFilter {
  type?: TelemetryEventType;
  modelId?: string;
  providerId?: string;
  toolName?: string;
  sessionIdHash?: string;
  limit?: number;
}

export interface TelemetryQueryWindow {
  total: number;
  events: TelemetryEvent[];
}

export interface TelemetrySink {
  record(event: Omit<TelemetryEvent, "timestamp">): void;
  query(filter: TelemetryFilter): TelemetryQueryWindow;
}

export interface TelemetryReadable extends TelemetrySink {
  getEvents(): readonly TelemetryEvent[];
}
