import type { TelemetryEvent } from "./types.js";
import { hashSessionId } from "../security/sessionHash.js";
import { sanitizeMetadata } from "../security/sanitize.js";

export function sanitizeTelemetryEvent(
  event: Omit<TelemetryEvent, "timestamp"> | TelemetryEvent
): Omit<TelemetryEvent, "timestamp"> | TelemetryEvent {
  const { sessionId, sessionIdHash: _untrustedSessionIdHash, ...withoutRawSession } = event;

  return {
    ...withoutRawSession,
    ...(sessionId ? { sessionIdHash: hashSessionId(sessionId) } : {}),
    metadata: sanitizeMetadata(event.metadata)
  };
}

export { sanitizeMetadata };
