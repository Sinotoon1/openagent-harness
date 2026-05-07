import { dirname } from "node:path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { hashSessionId } from "../security/sessionHash.js";
import { sanitizeMetadata } from "../security/sanitize.js";
import { sanitizeTelemetryEvent } from "./redaction.js";
import { filterTelemetryEvents } from "./memory.js";
import { telemetryEventTypes } from "./types.js";
import type {
  TelemetryEvent,
  TelemetryFilter,
  TelemetryQueryWindow,
  TelemetrySink
} from "./types.js";

export class JsonlTelemetrySink implements TelemetrySink {
  constructor(private readonly filePath: string) {
    ensureJsonlFile(filePath);
  }

  record(event: Omit<TelemetryEvent, "timestamp">): void {
    const sanitizedEvent = {
      ...sanitizeTelemetryEvent(event),
      timestamp: new Date().toISOString()
    };

    appendFileSync(this.filePath, `${JSON.stringify(sanitizedEvent)}\n`, "utf8");
  }

  query(filter: TelemetryFilter): TelemetryQueryWindow {
    const events = this.readEvents();
    const matched = filterTelemetryEvents(events, filter);

    return {
      total: matched.length,
      events: filter.limit === undefined ? matched : matched.slice(-filter.limit)
    };
  }

  private readEvents(): TelemetryEvent[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const text = readFileSync(this.filePath, "utf8");
    if (text.trim().length === 0) {
      return [];
    }

    const events: TelemetryEvent[] = [];
    for (const line of text.split(/\r?\n/)) {
      const event = parseTelemetryLine(line);
      if (event) {
        events.push(event);
      }
    }

    return events;
  }
}

function ensureJsonlFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "", "utf8");
  }
}

function parseTelemetryLine(line: string): TelemetryEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed) || !isTelemetryEventType(parsed.type)) {
    return undefined;
  }

  const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
  if (!timestamp) {
    return undefined;
  }

  return {
    type: parsed.type,
    timestamp,
    ...(typeof parsed.sessionId === "string"
      ? { sessionIdHash: hashSessionId(parsed.sessionId) }
      : {}),
    ...(!("sessionId" in parsed) && isSafeSessionIdHash(parsed.sessionIdHash)
      ? { sessionIdHash: parsed.sessionIdHash }
      : {}),
    ...(typeof parsed.modelId === "string"
      ? { modelId: parsed.modelId as TelemetryEvent["modelId"] }
      : {}),
    ...(typeof parsed.providerId === "string"
      ? { providerId: parsed.providerId as TelemetryEvent["providerId"] }
      : {}),
    ...(typeof parsed.capability === "string"
      ? { capability: parsed.capability as TelemetryEvent["capability"] }
      : {}),
    ...(typeof parsed.toolName === "string" ? { toolName: parsed.toolName } : {}),
    ...(isRecord(parsed.metadata) ? { metadata: sanitizeMetadata(parsed.metadata) } : {})
  };
}

function isTelemetryEventType(value: unknown): value is TelemetryEvent["type"] {
  return typeof value === "string" && (telemetryEventTypes as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isSafeSessionIdHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
