import type {
  CanonicalModelId,
  CapabilityFlags,
  CapabilityName,
  ProviderId
} from "../types.js";
import { capabilityNames } from "../types.js";
import type { TelemetrySink } from "../telemetry/types.js";
import type { ProviderAdapter } from "../providers/types.js";

export interface CapabilityNegotiationResult {
  capabilities: CapabilityFlags;
  droppedCapabilities: CapabilityName[];
}

export function negotiateCapabilities(
  requested: CapabilityFlags | undefined,
  providers: ProviderAdapter[],
  metadata: {
    sessionId?: string;
    modelId?: CanonicalModelId;
    telemetry?: TelemetrySink;
  } = {}
): CapabilityNegotiationResult {
  const capabilities: CapabilityFlags = {};
  const droppedCapabilities: CapabilityName[] = [];

  for (const capability of capabilityNames) {
    if (!requested?.[capability]) {
      continue;
    }

    const supportedBySelectedProviders = providers.every(
      (provider) => provider.capabilities[capability]
    );

    if (supportedBySelectedProviders) {
      capabilities[capability] = true;
      continue;
    }

    droppedCapabilities.push(capability);
    metadata.telemetry?.record({
      type: "capability_dropped",
      sessionId: metadata.sessionId,
      modelId: metadata.modelId,
      capability,
      metadata: {
        selectedProviders: providers.map((provider) => provider.id)
      }
    });
  }

  return { capabilities, droppedCapabilities };
}

export function applyProviderModelOverrides(
  modelId: CanonicalModelId,
  providerId: ProviderId,
  capabilities: CapabilityFlags,
  metadata: {
    sessionId?: string;
    telemetry?: TelemetrySink;
  } = {}
): CapabilityFlags {
  if (modelId === "deepseek-v4-pro" && providerId === "providerTwo" && capabilities.thinking) {
    const next = { ...capabilities };
    delete next.thinking;
    metadata.telemetry?.record({
      type: "thinking_overridden",
      sessionId: metadata.sessionId,
      modelId,
      providerId,
      capability: "thinking",
      metadata: {
        reason: "deepseek-v4-pro on providerTwo must run with thinking disabled"
      }
    });
    return next;
  }

  return capabilities;
}
