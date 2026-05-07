import type { CapabilityFlags, ProviderId } from "../types.js";
import { canonicalModelIds, providerIds } from "../types.js";
import type { ProviderRuntimeConfigMap, ProviderRuntimeDefinition } from "./config.js";
import { loadProviderRuntimeConfigs } from "./config.js";
import { OpenAICompatibleProviderAdapter } from "./openAiCompatible.js";
import type { ProviderAdapter } from "./types.js";

const providerCapabilities: Record<ProviderId, Required<CapabilityFlags>> = {
  providerOne: {
    zeroDataRetention: true,
    disallowPromptTraining: true,
    thinking: true
  },
  providerTwo: {
    zeroDataRetention: true,
    disallowPromptTraining: false,
    thinking: true
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
    canonicalModelIds.map((modelId) => {
      const slugConfig = providerConfig.modelSlugs[modelId];
      return [modelId, slugConfig.env ? env[slugConfig.env] ?? slugConfig.default : slugConfig.default];
    })
  );
}
