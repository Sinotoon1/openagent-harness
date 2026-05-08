import type {
  CanonicalModelId,
  CapabilityName,
  ProviderId
} from "../types.js";
import type { TelemetryEventType } from "../constants/telemetryEvents.js";
export {
  telemetryEventTypes,
  type TelemetryEventType
} from "../constants/telemetryEvents.js";

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
