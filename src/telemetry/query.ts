import type {
  TelemetryEvent,
  TelemetryEventType,
  TelemetryReadable,
  TelemetrySink
} from "./types.js";
import { hashSessionId } from "../security/sessionHash.js";
import { sanitizeMetadata } from "../security/sanitize.js";

export interface TelemetryQuery {
  type?: TelemetryEventType;
  modelId?: string;
  providerId?: string;
  toolName?: string;
  sessionId?: string;
  limit?: number;
  includeMetadata?: boolean;
}

export interface TelemetryQueryResult {
  total: number;
  returned: number;
  events: TelemetryEvent[];
}

export function queryTelemetry(
  telemetry: TelemetrySink,
  query: TelemetryQuery
): TelemetryQueryResult {
  if (!isTelemetryReadable(telemetry)) {
    return {
      total: 0,
      returned: 0,
      events: []
    };
  }

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const sessionIdHash = query.sessionId ? hashSessionId(query.sessionId) : undefined;
  const matched = telemetry
    .getEvents()
    .filter((event) => query.type === undefined || event.type === query.type)
    .filter((event) => query.modelId === undefined || event.modelId === query.modelId)
    .filter((event) => query.providerId === undefined || event.providerId === query.providerId)
    .filter((event) => query.toolName === undefined || event.toolName === query.toolName)
    .filter((event) => sessionIdHash === undefined || event.sessionIdHash === sessionIdHash);

  const events = matched.slice(-limit).map((event) => {
    const { sessionId: _sessionId, ...safeEvent } = event;
    if (query.includeMetadata) {
      return {
        ...safeEvent,
        metadata: sanitizeMetadata(event.metadata)
      };
    }

    const { metadata: _metadata, ...withoutMetadata } = safeEvent;
    return withoutMetadata;
  });

  return {
    total: matched.length,
    returned: events.length,
    events
  };
}

function isTelemetryReadable(telemetry: TelemetrySink): telemetry is TelemetryReadable {
  return typeof (telemetry as Partial<TelemetryReadable>).getEvents === "function";
}
