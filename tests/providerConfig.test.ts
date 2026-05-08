import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderConfigError,
  loadProviderRuntimeConfigs,
  parseProviderRuntimeConfigs
} from "../src/providers/config.js";
import { createProviderAdaptersFromEnv } from "../src/providers/registry.js";

const validProvider = (id: "deepseekPrimary" | "openrouterFallback") => ({
  id,
  baseUrlEnv:
    id === "deepseekPrimary" ? "DEEPSEEK_PRIMARY_BASE_URL" : "OPENROUTER_FALLBACK_BASE_URL",
  authEnvVar:
    id === "deepseekPrimary" ? "DEEPSEEK_PRIMARY_API_KEY" : "OPENROUTER_FALLBACK_API_KEY",
  stickySession: {
    header: id === "deepseekPrimary" ? "X-Session-Id" : "X-Routing-Key",
    strategy: id === "deepseekPrimary" ? "raw" : "hash"
  },
  modelSlugs:
    id === "deepseekPrimary"
      ? {
          "deepseek-v4-pro": {
            env: "DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG",
            default: "deepseek-v4-pro"
          }
        }
      : {
          "kimi-k2-6": {
            env: "OPENROUTER_FALLBACK_KIMI_K2_6_SLUG",
            default: "kimi-k2-6"
          },
          "deepseek-v4-pro": {
            env: "OPENROUTER_FALLBACK_DEEPSEEK_V4_PRO_SLUG",
            default: "deepseek-v4-pro"
          },
          "deepseek-v4-flash": {
            env: "OPENROUTER_FALLBACK_DEEPSEEK_V4_FLASH_SLUG",
            default: "deepseek-v4-flash"
          }
        }
});

const validConfig = () => ({
  providers: [validProvider("deepseekPrimary"), validProvider("openrouterFallback")]
});

const validConfigYaml = () => `
providers:
  - id: deepseekPrimary
    baseUrlEnv: DEEPSEEK_PRIMARY_BASE_URL
    authEnvVar: DEEPSEEK_PRIMARY_API_KEY
    stickySession:
      header: X-External-Session-Id
      strategy: raw
    modelSlugs:
      deepseek-v4-pro:
        env: DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG
        default: deepseek-v4-pro
  - id: openrouterFallback
    baseUrlEnv: OPENROUTER_FALLBACK_BASE_URL
    authEnvVar: OPENROUTER_FALLBACK_API_KEY
    stickySession:
      header: X-Routing-Key
      strategy: hash
    modelSlugs:
      kimi-k2-6:
        env: OPENROUTER_FALLBACK_KIMI_K2_6_SLUG
        default: kimi-k2-6
      deepseek-v4-pro:
        env: OPENROUTER_FALLBACK_DEEPSEEK_V4_PRO_SLUG
        default: deepseek-v4-pro
      deepseek-v4-flash:
        env: OPENROUTER_FALLBACK_DEEPSEEK_V4_FLASH_SLUG
        default: deepseek-v4-flash
`;

const withProviderConfigFile = (contents: string): { dir: string; path: string } => {
  const dir = mkdtempSync(join(tmpdir(), "oss-harness-provider-config-"));
  const path = join(dir, "providers.local.yaml");
  writeFileSync(path, contents, "utf8");
  return { dir, path };
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("provider configuration validation", () => {
  it("loads bundled provider config when OSS_HARNESS_PROVIDER_CONFIG_PATH is unset", () => {
    const configs = loadProviderRuntimeConfigs();

    expect(configs.deepseekPrimary.baseUrlEnv).toBe("DEEPSEEK_PRIMARY_BASE_URL");
    expect(configs.openrouterFallback.authEnvVar).toBe("OPENROUTER_FALLBACK_API_KEY");
  });

  it("loads external provider config path successfully", () => {
    const { dir, path } = withProviderConfigFile(validConfigYaml());
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);

    const configs = loadProviderRuntimeConfigs();

    expect(configs.deepseekPrimary.stickySession.header).toBe("X-External-Session-Id");
    expect(configs.deepseekPrimary.modelSlugs["deepseek-v4-pro"]?.default).toBe(
      "deepseek-v4-pro"
    );
  });

  it("validates external provider config with existing provider validation", () => {
    const { dir, path } = withProviderConfigFile(validConfigYaml().replace("strategy: raw", "strategy: cookie"));
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);

    expect(() => loadProviderRuntimeConfigs()).toThrow(ProviderConfigError);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/stickySession.strategy/);
  });

  it("returns a clear error for a missing external provider config file", () => {
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", join(tmpdir(), "missing-providers.yaml"));

    expect(() => loadProviderRuntimeConfigs()).toThrow(ProviderConfigError);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/Provider config file not found/);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/missing-providers\.yaml/);
  });

  it("returns a clear error for invalid external provider YAML", () => {
    const { dir, path } = withProviderConfigFile("providers:\n  - id: deepseekPrimary\n    bad: [");
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);

    expect(() => loadProviderRuntimeConfigs()).toThrow(ProviderConfigError);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/Provider config YAML is invalid/);
  });

  it("returns a clear error for invalid external provider config shape", () => {
    const { dir, path } = withProviderConfigFile("providers: []\n");
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);

    expect(() => loadProviderRuntimeConfigs()).toThrow(ProviderConfigError);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/Provider config is invalid/);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/providers/);
  });

  it("returns a clear error for missing required external provider fields", () => {
    const { dir, path } = withProviderConfigFile(
      validConfigYaml().replace("    authEnvVar: DEEPSEEK_PRIMARY_API_KEY\n", "")
    );
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);

    expect(() => loadProviderRuntimeConfigs()).toThrow(ProviderConfigError);
    expect(() => loadProviderRuntimeConfigs()).toThrow(/authEnvVar/);
  });

  it("uses env var names from external config without exposing env values", () => {
    const { dir, path } = withProviderConfigFile(validConfigYaml());
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);
    vi.stubEnv("DEEPSEEK_PRIMARY_BASE_URL", "https://secret-provider.example/v1");
    vi.stubEnv("DEEPSEEK_PRIMARY_API_KEY", "super-secret-key");

    const configs = loadProviderRuntimeConfigs();

    expect(JSON.stringify(configs)).toContain("DEEPSEEK_PRIMARY_API_KEY");
    expect(JSON.stringify(configs)).not.toContain("super-secret-key");
    expect(JSON.stringify(configs)).not.toContain("https://secret-provider.example/v1");
  });

  it("keeps provider enablement gated by baseUrl env value", () => {
    const { dir, path } = withProviderConfigFile(validConfigYaml());
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);
    vi.stubEnv("DEEPSEEK_PRIMARY_API_KEY", "test-key");

    const adapters = createProviderAdaptersFromEnv(process.env, loadProviderRuntimeConfigs());

    expect(adapters).toHaveLength(0);
  });

  it("lets deepseekPrimary from external config support deepseek-v4-pro", () => {
    const { dir, path } = withProviderConfigFile(validConfigYaml());
    tempDirs.push(dir);
    vi.stubEnv("OSS_HARNESS_PROVIDER_CONFIG_PATH", path);
    vi.stubEnv("DEEPSEEK_PRIMARY_BASE_URL", "https://deepseek-primary.example/v1");

    const adapters = createProviderAdaptersFromEnv(process.env, loadProviderRuntimeConfigs());

    expect(adapters[0]?.id).toBe("deepseekPrimary");
    expect(adapters[0]?.supportedModels).toEqual(["deepseek-v4-pro"]);
  });

  it("loads valid provider configuration without requiring API key values", () => {
    const configs = parseProviderRuntimeConfigs(validConfig());
    const adapters = createProviderAdaptersFromEnv(
      {
        DEEPSEEK_PRIMARY_BASE_URL: "https://deepseek-primary.example/v1"
      },
      configs
    );

    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.id).toBe("deepseekPrimary");
    expect(adapters[0]?.supportedModels).toEqual(["deepseek-v4-pro"]);
    expect(adapters[0]?.capabilities.thinking).toBe(false);
  });

  it("uses DEEPSEEK_PRIMARY_API_KEY as the auth environment variable", async () => {
    const configs = parseProviderRuntimeConfigs(validConfig());
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer test-key"
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapters = createProviderAdaptersFromEnv(
      {
        DEEPSEEK_PRIMARY_BASE_URL: "https://deepseek-primary.example/v1",
        DEEPSEEK_PRIMARY_API_KEY: "test-key"
      },
      configs
    );

    expect(adapters[0]?.id).toBe("deepseekPrimary");
    await adapters[0]?.completeChat({
      modelId: "deepseek-v4-pro",
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
      capabilities: {}
    });
    expect(fetchMock).toHaveBeenCalledOnce();
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
      providers: [validProvider("deepseekPrimary"), validProvider("deepseekPrimary")]
    };

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/duplicate provider id: deepseekPrimary/);
  });

  it("rejects invalid model slug mappings", () => {
    const config = validConfig();
    (config.providers[0]!.modelSlugs as Record<string, unknown>)["not-a-model"] = {
      default: "bad-slug"
    };

    expect(() => parseProviderRuntimeConfigs(config)).toThrow(/modelSlugs/);
  });
});
