import { sanitizeTelemetryEvent } from "./redaction.js";
import type {
  TelemetryEvent,
  TelemetryFilter,
  TelemetryQueryWindow,
  TelemetryReadable
} from "./types.js";

export class MemoryTelemetrySink implements TelemetryReadable {
  readonly events: TelemetryEvent[] = [];

  record(event: Omit<TelemetryEvent, "timestamp">): void {
    this.events.push({
      ...sanitizeTelemetryEvent(event),
      timestamp: new Date().toISOString()
    });
  }

  getEvents(): readonly TelemetryEvent[] {
    return this.events;
  }

  query(filter: TelemetryFilter): TelemetryQueryWindow {
    const matched = filterTelemetryEvents(this.events, filter);
    return {
      total: matched.length,
      events: filter.limit === undefined ? matched : matched.slice(-filter.limit),
      ...(filter.includeDiagnostics
        ? {
            diagnostics: {
              sinkType: "memory" as const,
              returnedWindowLimit: filter.limit,
              fullFileRead: false,
              warnings: []
            }
          }
        : {})
    };
  }
}

export class InMemoryTelemetrySink extends MemoryTelemetrySink {}

export const defaultTelemetrySink = new MemoryTelemetrySink();

export function filterTelemetryEvents(
  events: readonly TelemetryEvent[],
  filter: TelemetryFilter
): TelemetryEvent[] {
  return events
    .filter((event) => filter.type === undefined || event.type === filter.type)
    .filter((event) => filter.modelId === undefined || event.modelId === filter.modelId)
    .filter((event) => filter.providerId === undefined || event.providerId === filter.providerId)
    .filter((event) => filter.toolName === undefined || event.toolName === filter.toolName)
    .filter(
      (event) => filter.sessionIdHash === undefined || event.sessionIdHash === filter.sessionIdHash
    );
}
