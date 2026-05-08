export const telemetryEvent = {
  providerFallback: "provider_fallback",
  toolInputRepaired: "tool_input_repaired",
  toolInputNormalized: "tool_input_normalized",
  toolInputInvalid: "tool_input_invalid",
  capabilityDropped: "capability_dropped",
  capabilityNegotiated: "capability_negotiated",
  thinkingOverridden: "thinking_overridden",
  cacheLikelyWarm: "cache_likely_warm",
  cacheLikelyCold: "cache_likely_cold",
  contextCompacted: "context_compacted",
  evalEventRecorded: "eval_event_recorded"
} as const;

export const telemetryEventTypes = [
  telemetryEvent.providerFallback,
  telemetryEvent.toolInputRepaired,
  telemetryEvent.toolInputNormalized,
  telemetryEvent.toolInputInvalid,
  telemetryEvent.capabilityDropped,
  telemetryEvent.capabilityNegotiated,
  telemetryEvent.thinkingOverridden,
  telemetryEvent.cacheLikelyWarm,
  telemetryEvent.cacheLikelyCold,
  telemetryEvent.contextCompacted,
  telemetryEvent.evalEventRecorded
] as const;

export type TelemetryEventType = (typeof telemetryEventTypes)[number];
