import type { CapabilityFlags } from "../types.js";
import type { ProviderRuntimeConfigMap } from "./config.js";
import { loadProviderRuntimeConfigs } from "./config.js";
import { OpenAICompatibleProviderAdapter } from "./openAiCompatible.js";
import type { ProviderAdapter } from "./types.js";

const providerOneCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

const providerTwoCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: false,
  thinking: true
};

export function createProviderAdaptersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  providerConfigs: ProviderRuntimeConfigMap = loadProviderRuntimeConfigs()
): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];

  if (env.PROVIDER_ONE_BASE_URL) {
    adapters.push(
      new OpenAICompatibleProviderAdapter({
        id: "providerOne",
        baseUrl: env.PROVIDER_ONE_BASE_URL,
        apiKey: env.PROVIDER_ONE_API_KEY,
        providerConfig: providerConfigs.providerOne,
        capabilities: providerOneCapabilities,
        modelSlugs: {
          "kimi-k2-6": env.PROVIDER_ONE_KIMI_K2_6_SLUG ?? "kimi-k2-6",
          "deepseek-v4-pro":
            env.PROVIDER_ONE_DEEPSEEK_V4_PRO_SLUG ?? "deepseek-v4-pro",
          "deepseek-flash":
            env.PROVIDER_ONE_DEEPSEEK_FLASH_SLUG ?? "deepseek-flash"
        }
      })
    );
  }

  if (env.PROVIDER_TWO_BASE_URL) {
    adapters.push(
      new OpenAICompatibleProviderAdapter({
        id: "providerTwo",
        baseUrl: env.PROVIDER_TWO_BASE_URL,
        apiKey: env.PROVIDER_TWO_API_KEY,
        providerConfig: providerConfigs.providerTwo,
        capabilities: providerTwoCapabilities,
        modelSlugs: {
          "kimi-k2-6": env.PROVIDER_TWO_KIMI_K2_6_SLUG ?? "kimi-k2-6",
          "deepseek-v4-pro":
            env.PROVIDER_TWO_DEEPSEEK_V4_PRO_SLUG ?? "deepseek-v4-pro",
          "deepseek-flash":
            env.PROVIDER_TWO_DEEPSEEK_FLASH_SLUG ?? "deepseek-flash"
        }
      })
    );
  }

  return adapters;
}
