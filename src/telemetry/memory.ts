import { sanitizeTelemetryEvent } from "./redaction.js";
import type { TelemetryEvent, TelemetryReadable } from "./types.js";

export class InMemoryTelemetrySink implements TelemetryReadable {
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
}

export const defaultTelemetrySink = new InMemoryTelemetrySink();
