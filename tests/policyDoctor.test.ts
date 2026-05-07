import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPolicyDoctor } from "../src/diagnostics/policyDoctor.js";
import { loadAllModelPolicies } from "../src/policies/loader.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";

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

const validProviderConfig = () => ({
  providers: [validProvider("providerOne"), validProvider("providerTwo")]
});

const basePolicy = {
  modelId: "kimi-k2-6",
  repairs: ["bareStringToArray"],
  effectiveContextTokens: 96000
};

describe("policy doctor", () => {
  it("reports current policies without errors", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false },
      {
        policies: loadAllModelPolicies(),
        providerConfig: validProviderConfig(),
        env: {
          PROVIDER_ONE_BASE_URL: "https://provider-one.example/v1",
          PROVIDER_TWO_BASE_URL: "https://provider-two.example/v1"
        }
      }
    );

    expect(["ok", "warning"]).toContain(report.status);
    expect(report.summary.modelsChecked).toBe(3);
    expect(report.summary.providersChecked).toBe(2);
    expect(report.summary.errors).toBe(0);
  });

  it("filters by modelId", () => {
    const report = runPolicyDoctor(
      { modelId: "deepseek-v4-pro", includeTelemetry: false, includeProviderConfig: false },
      { policies: loadAllModelPolicies() }
    );

    expect(report.summary.modelsChecked).toBe(1);
    expect(report.issues.every((issue) => issue.modelId === "deepseek-v4-pro")).toBe(true);
  });

  it("warns about duplicate providerOverrides", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false, includeProviderConfig: false },
      {
        policies: [
          {
            ...basePolicy,
            providerOverrides: [
              { providerId: "providerOne", thinking: "disabled" },
              { providerId: "providerOne", thinking: "enabled" }
            ]
          }
        ]
      }
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "duplicate_provider_override",
        modelId: "kimi-k2-6",
        providerId: "providerOne"
      })
    );
  });

  it("warns about unknown providerOverrides", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false, includeProviderConfig: false },
      {
        policies: [
          {
            ...basePolicy,
            providerOverrides: [{ providerId: "providerThree", thinking: "disabled" }]
          }
        ]
      }
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "unknown_provider_override",
        modelId: "kimi-k2-6",
        providerId: "providerThree"
      })
    );
  });

  it("warns about empty repairs", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false, includeProviderConfig: false },
      { policies: [{ ...basePolicy, repairs: [] }] }
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "empty_repairs",
        modelId: "kimi-k2-6"
      })
    );
  });

  it("reports invalid context thresholds", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false, includeProviderConfig: false },
      {
        policies: [
          {
            ...basePolicy,
            contextThresholds: {
              dropDeadToolCalls: 90000,
              aggressiveDrop: 80000,
              summarizeOldContext: 70000
            }
          }
        ]
      }
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "context_threshold_order",
          modelId: "kimi-k2-6"
        })
      ])
    );
  });

  it("reports disabled providers with missing base URL as info", () => {
    const report = runPolicyDoctor(
      { includeTelemetry: false },
      {
        policies: [basePolicy],
        providerConfig: validProviderConfig(),
        env: {}
      }
    );

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "info",
          code: "provider_base_url_env_missing",
          providerId: "providerOne"
        }),
        expect.objectContaining({
          severity: "info",
          code: "provider_base_url_env_missing",
          providerId: "providerTwo"
        })
      ])
    );
    expect(report.summary.errors).toBe(0);
  });

  it("warns when telemetry suggests a different repair order", () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["stripNullOptional"], 3);
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray"], 1);

    const report = runPolicyDoctor(
      { modelId: "kimi-k2-6", includeProviderConfig: false },
      { policies: [basePolicy], telemetry }
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        code: "suggested_repair_order_mismatch",
        modelId: "kimi-k2-6"
      })
    );
  });

  it("suppresses telemetry issues when includeTelemetry is false", () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["stripNullOptional"], 3);

    const report = runPolicyDoctor(
      { includeTelemetry: false, includeProviderConfig: false },
      { policies: [basePolicy], telemetry }
    );

    expect(report.issues.some((issue) => issue.code.includes("telemetry"))).toBe(false);
    expect(report.issues.some((issue) => issue.code.includes("suggested_repair"))).toBe(false);
  });

  it("filters by minimum severity", () => {
    const report = runPolicyDoctor(
      { severity: "warning", includeTelemetry: false },
      {
        policies: [basePolicy],
        providerConfig: validProviderConfig(),
        env: {}
      }
    );

    expect(report.issues.every((issue) => issue.severity !== "info")).toBe(true);
    expect(report.summary.infos).toBe(0);
  });

  it("sanitizes output and does not leak secrets or raw env values", () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "raw-doctor-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray", "token=raw-repair-token"],
        apiKey: "raw-api-key-value",
        env: {
          PROVIDER_ONE_BASE_URL: "https://secret-provider.example/v1"
        },
        messages: [{ role: "user", content: "raw prompt content" }]
      }
    });

    const reportText = JSON.stringify(
      runPolicyDoctor(
        { modelId: "kimi-k2-6", includeProviderConfig: true },
        {
          policies: [basePolicy],
          providerConfig: validProviderConfig(),
          env: {
            PROVIDER_ONE_BASE_URL: "https://secret-provider.example/v1"
          },
          telemetry
        }
      )
    );

    expect(reportText).not.toContain("raw-doctor-session");
    expect(reportText).not.toContain("raw-repair-token");
    expect(reportText).not.toContain("raw-api-key-value");
    expect(reportText).not.toContain("https://secret-provider.example/v1");
    expect(reportText).not.toContain("raw prompt content");
  });

  it("does not write project files", () => {
    const files = ["src/policies/kimi-k2-6.yaml", "src/providers/providers.yaml", "package.json"];
    const before = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));

    runPolicyDoctor(
      { includeTelemetry: false },
      {
        policies: [basePolicy],
        providerConfig: validProviderConfig(),
        env: {}
      }
    );

    for (const file of files) {
      expect(readFileSync(file, "utf8")).toBe(before.get(file));
    }
  });
});

function recordRepairEvents(
  telemetry: InMemoryTelemetrySink,
  modelId: string,
  repairs: string[],
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    telemetry.record({
      type: "tool_input_repaired",
      modelId: modelId as never,
      toolName: "repair_tool_input",
      metadata: {
        repairs
      }
    });
  }
}
