import { basename, dirname } from "node:path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { hashSessionId } from "../security/sessionHash.js";
import { sanitizeMetadata } from "../security/sanitize.js";
import { sanitizeTelemetryEvent } from "./redaction.js";
import { filterTelemetryEvents } from "./memory.js";
import { telemetryEventTypes } from "./types.js";
import type {
  TelemetryEvent,
  TelemetryDiagnostics,
  TelemetryFilter,
  TelemetryQueryWindow,
  TelemetrySink
} from "./types.js";

const jsonlFileSizeWarningBytes = 10 * 1024 * 1024;

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
    const { events, diagnostics } = this.readEvents(filter.limit);
    const matched = filterTelemetryEvents(events, filter);

    return {
      total: matched.length,
      events: filter.limit === undefined ? matched : matched.slice(-filter.limit),
      ...(filter.includeDiagnostics ? { diagnostics } : {})
    };
  }

  private readEvents(returnedWindowLimit: number | undefined): {
    events: TelemetryEvent[];
    diagnostics: TelemetryDiagnostics;
  } {
    const baseDiagnostics = (): TelemetryDiagnostics => ({
      sinkType: "jsonl",
      filePath: basename(this.filePath),
      fileExists: false,
      fileSizeBytes: 0,
      totalLines: 0,
      parsedLines: 0,
      malformedLineCount: 0,
      skippedLineCount: 0,
      returnedWindowLimit,
      fullFileRead: true,
      warnings: []
    });

    if (!existsSync(this.filePath)) {
      return { events: [], diagnostics: baseDiagnostics() };
    }

    const fileSizeBytes = statSync(this.filePath).size;
    const warnings =
      fileSizeBytes > jsonlFileSizeWarningBytes
        ? [
            `JSONL telemetry file exceeds ${jsonlFileSizeWarningBytes} bytes; reads currently scan the full file.`
          ]
        : [];
    const text = readFileSync(this.filePath, "utf8");
    const lines = jsonlLines(text);

    const events: TelemetryEvent[] = [];
    let malformedLineCount = 0;
    let skippedLineCount = 0;
    for (const line of lines) {
      const result = parseTelemetryLine(line);
      if (result.event) {
        events.push(result.event);
        continue;
      }
      if (result.malformed) {
        malformedLineCount += 1;
      }
      skippedLineCount += 1;
    }

    return {
      events,
      diagnostics: {
        sinkType: "jsonl",
        filePath: basename(this.filePath),
        fileExists: true,
        fileSizeBytes,
        totalLines: lines.length,
        parsedLines: events.length,
        malformedLineCount,
        skippedLineCount,
        returnedWindowLimit,
        fullFileRead: true,
        warnings
      }
    };
  }
}

function ensureJsonlFile(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "", "utf8");
  }
}

function jsonlLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  return text.replace(/\r?\n$/, "").split(/\r?\n/);
}

function parseTelemetryLine(line: string): { event?: TelemetryEvent; malformed: boolean } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { malformed: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return { malformed: true };
  }

  if (!isRecord(parsed) || !isTelemetryEventType(parsed.type)) {
    return { malformed: false };
  }

  const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : undefined;
  if (!timestamp) {
    return { malformed: false };
  }

  return {
    event: {
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
    },
    malformed: false
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
