import { describe, expect, it } from "vitest";
import {
  ProviderConfigError,
  parseProviderRuntimeConfigs
} from "../src/providers/config.js";
import { createProviderAdaptersFromEnv } from "../src/providers/registry.js";

const validProvider = (id: "providerOne" | "providerTwo") => ({
  id,
  baseUrlEnv: id === "providerOne" ? "PROVIDER_ONE_BASE_URL" : "PROVIDER_TWO_BASE_URL",
  authEnvVar: id === "providerOne" ? "PROVIDER_ONE_API_KEY" : "PROVIDER_TWO_API_KEY",
  stickySession: {
    header: id === "providerOne" ? "X-Session-Id" : "X-Routing-Key",
    strategy: id === "providerOne" ? "raw" : "hash"
  },
  modelSlugs: {
    "kimi-k2-6": {
      env: id === "providerOne" ? "PROVIDER_ONE_KIMI_K2_6_SLUG" : "PROVIDER_TWO_KIMI_K2_6_SLUG",
      default: "kimi-k2-6"
    },
    "deepseek-v4-pro": {
      env:
        id === "providerOne"
          ? "PROVIDER_ONE_DEEPSEEK_V4_PRO_SLUG"
          : "PROVIDER_TWO_DEEPSEEK_V4_PRO_SLUG",
      default: "deepseek-v4-pro"
    },
    "deepseek-flash": {
      env:
        id === "providerOne"
          ? "PROVIDER_ONE_DEEPSEEK_FLASH_SLUG"
          : "PROVIDER_TWO_DEEPSEEK_FLASH_SLUG",
      default: "deepseek-flash"
    }
  }
});

const validConfig = () => ({
  providers: [validProvider("providerOne"), validProvider("providerTwo")]
});

describe("provider configuration validation", () => {
  it("loads valid provider configuration without requiring API key values", () => {
    const configs = parseProviderRuntimeConfigs(validConfig());
    const adapters = createProviderAdaptersFromEnv(
      {
        PROVIDER_ONE_BASE_URL: "https://provider-one.example/v1"
      },
      configs
    );

    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.id).toBe("providerOne");
  });

  it("rejects missing base URL environment variable names", () => {
    const config = validConfig();
    delete (config.providers[0] as Partial<ReturnType<typeof validProvider>>).baseUrlEnv;

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(ProviderConfigError);
    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/baseUrlEnv/);
  });

  it("rejects missing auth environment variable names", () => {
    const config = validConfig();
    delete (config.providers[0] as Partial<ReturnType<typeof validProvider>>).authEnvVar;

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(ProviderConfigError);
    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/authEnvVar/);
  });

  it("rejects invalid sticky session strategies", () => {
    const config = validConfig();
    config.providers[0]!.stickySession.strategy = "cookie";

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/stickySession.strategy/);
  });

  it("rejects duplicate provider IDs", () => {
    const config = {
      providers: [validProvider("providerOne"), validProvider("providerOne")]
    };

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/duplicate provider id: providerOne/);
  });

  it("rejects invalid model slug mappings", () => {
    const config = validConfig();
    (config.providers[0]!.modelSlugs as Record<string, unknown>)["not-a-model"] = {
      default: "bad-slug"
    };

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/modelSlugs/);
  });
});
