import type { CapabilityFlags, ProviderId } from "../types.js";
import { canonicalModelIds, providerIds } from "../types.js";
import { capabilityName } from "../constants/capabilities.js";
import type { ProviderRuntimeConfigMap, ProviderRuntimeDefinition } from "./config.js";
import { loadProviderRuntimeConfigs } from "./config.js";
import { OpenAICompatibleProviderAdapter } from "./openAiCompatible.js";
import type { ProviderAdapter } from "./types.js";

const providerCapabilities: Record<ProviderId, Required<CapabilityFlags>> = {
  deepseekPrimary: {
    [capabilityName.zeroDataRetention]: true,
    [capabilityName.disallowPromptTraining]: true,
    [capabilityName.thinking]: false
  },
  openrouterFallback: {
    [capabilityName.zeroDataRetention]: true,
    [capabilityName.disallowPromptTraining]: false,
    [capabilityName.thinking]: true
  }
};

export function createProviderAdaptersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  providerConfigs: ProviderRuntimeConfigMap = loadProviderRuntimeConfigs()
): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];

  for (const providerId of providerIds) {
    const providerConfig = providerConfigs[providerId];
    const baseUrl = env[providerConfig.baseUrlEnv];
    if (!baseUrl) {
      continue;
    }

    adapters.push(
      new OpenAICompatibleProviderAdapter({
        id: providerId,
        baseUrl,
        apiKey: env[providerConfig.authEnvVar],
        providerConfig,
        capabilities: providerCapabilities[providerId],
        modelSlugs: resolveModelSlugs(providerConfig, env)
      })
    );
  }

  return adapters;
}

function resolveModelSlugs(
  providerConfig: ProviderRuntimeDefinition,
  env: NodeJS.ProcessEnv
) {
  return Object.fromEntries(
    canonicalModelIds.flatMap((modelId) => {
      const slugConfig = providerConfig.modelSlugs[modelId];
      if (!slugConfig) {
        return [];
      }

      return [[modelId, slugConfig.env ? env[slugConfig.env] ?? slugConfig.default : slugConfig.default]];
    })
  );
}
