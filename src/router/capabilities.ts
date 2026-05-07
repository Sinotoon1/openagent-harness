import type {
  CapabilityFlags,
  CapabilityName,
  ProviderId
} from "../types.js";
import { capabilityNames } from "../types.js";
import type { ModelPolicy, ProviderModelOverride } from "../policies/types.js";
import type { TelemetrySink } from "../telemetry/types.js";
import type { ProviderAdapter } from "../providers/types.js";

export interface CapabilityNegotiationResult {
  capabilities: CapabilityFlags;
  droppedCapabilities: CapabilityName[];
}

export function negotiateCapabilities(
  requested: CapabilityFlags | undefined,
  provider: ProviderAdapter,
  metadata: {
    sessionId?: string;
    modelId?: ModelPolicy["modelId"];
    attemptIndex?: number;
    telemetry?: TelemetrySink;
  } = {}
): CapabilityNegotiationResult {
  const capabilities: CapabilityFlags = {};
  const droppedCapabilities: CapabilityName[] = [];

  for (const capability of capabilityNames) {
    if (!requested?.[capability]) {
      continue;
    }

    if (provider.capabilities[capability]) {
      capabilities[capability] = true;
      continue;
    }

    droppedCapabilities.push(capability);
    metadata.telemetry?.record({
      type: "capability_dropped",
      sessionId: metadata.sessionId,
      modelId: metadata.modelId,
      providerId: provider.id,
      capability,
      metadata: {
        reason: "unsupported_by_provider",
        ...(metadata.attemptIndex !== undefined ? { attemptIndex: metadata.attemptIndex } : {})
      }
    });
  }

  return { capabilities, droppedCapabilities };
}

export function applyProviderModelOverrides(
  modelPolicy: ModelPolicy,
  provider: ProviderAdapter,
  capabilities: CapabilityFlags,
  metadata: {
    sessionId?: string;
    attemptIndex?: number;
    telemetry?: TelemetrySink;
  } = {}
): CapabilityFlags {
  const override = modelPolicy.providerOverrides?.find(
    (candidate) => candidate.providerId === provider.id
  );
  if (!override || override.thinking === "unchanged") {
    return capabilities;
  }

  if (override.thinking === "disabled" && capabilities.thinking) {
    const next = { ...capabilities };
    delete next.thinking;
    recordThinkingOverride(modelPolicy, provider.id, override, metadata);
    return next;
  }

  if (override.thinking === "enabled" && provider.capabilities.thinking && !capabilities.thinking) {
    const next = { ...capabilities, thinking: true };
    recordThinkingOverride(modelPolicy, provider.id, override, metadata);
    return next;
  }

  return capabilities;
}

function recordThinkingOverride(
  modelPolicy: ModelPolicy,
  providerId: ProviderId,
  override: ProviderModelOverride,
  metadata: {
    sessionId?: string;
    attemptIndex?: number;
    telemetry?: TelemetrySink;
  }
): void {
  metadata.telemetry?.record({
    type: "thinking_overridden",
    sessionId: metadata.sessionId,
    modelId: modelPolicy.modelId,
    providerId,
    capability: "thinking",
    metadata: {
      reason: override.reason ?? `model policy set thinking ${override.thinking}`,
      source: "model_policy",
      override: `thinking_${override.thinking}`,
      ...(metadata.attemptIndex !== undefined ? { attemptIndex: metadata.attemptIndex } : {})
    }
  });
}
