import type {
  TelemetryEvent,
  TelemetryEventType,
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
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const sessionIdHash = query.sessionId ? hashSessionId(query.sessionId) : undefined;
  const telemetryWindow = telemetry.query({
    type: query.type,
    modelId: query.modelId,
    providerId: query.providerId,
    toolName: query.toolName,
    sessionIdHash,
    limit
  });

  const events = telemetryWindow.events.map((event) => {
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
    total: telemetryWindow.total,
    returned: events.length,
    events
  };
}
