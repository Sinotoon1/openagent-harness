import { describe, expect, it } from "vitest";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse
} from "../src/providers/types.js";
import { summarizeModelPolicyForInspection } from "../src/policies/inspect.js";
import { loadAllModelPolicies, loadModelPolicy } from "../src/policies/loader.js";
import { modelPolicySchema, type ModelPolicy } from "../src/policies/types.js";
import { applyProviderModelOverrides } from "../src/router/capabilities.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import type { CapabilityFlags, CanonicalModelId, ProviderId } from "../src/types.js";

const allCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

describe("model policy provider overrides", () => {
  it("loads the deepseek-v4-pro providerTwo thinking override from policy YAML", () => {
    const policy = loadModelPolicy("deepseek-v4-pro");

    expect(policy.providerOverrides).toEqual([
      {
        providerId: "providerTwo",
        thinking: "disabled",
        reason: "deepseek-v4-pro on providerTwo must run with thinking disabled"
      }
    ]);
  });

  it("does not apply a hardcoded deepseek-v4-pro providerTwo override without policy config", () => {
    const telemetry = new InMemoryTelemetrySink();
    const policyWithoutOverrides: ModelPolicy = {
      modelId: "deepseek-v4-pro",
      repairs: [],
      effectiveContextTokens: 100000
    };

    const capabilities = applyProviderModelOverrides(
      policyWithoutOverrides,
      fakeProvider("providerTwo"),
      { thinking: true },
      { telemetry }
    );

    expect(capabilities.thinking).toBe(true);
    expect(telemetry.events.filter((event) => event.type === "thinking_overridden")).toHaveLength(0);
  });

  it("loads existing policies that do not declare provider overrides", () => {
    const kimiPolicy = loadModelPolicy("kimi-k2-6");
    const policies = loadAllModelPolicies();

    expect(kimiPolicy.providerOverrides).toBeUndefined();
    expect(policies.map((policy) => policy.modelId)).toEqual([
      "kimi-k2-6",
      "deepseek-v4-pro",
      "deepseek-flash"
    ]);
  });

  it("does not add enabled thinking overrides when a provider does not support thinking", () => {
    const telemetry = new InMemoryTelemetrySink();
    const policy: ModelPolicy = {
      modelId: "kimi-k2-6",
      repairs: [],
      effectiveContextTokens: 96000,
      providerOverrides: [
        {
          providerId: "providerTwo",
          thinking: "enabled"
        }
      ]
    };

    const capabilities = applyProviderModelOverrides(
      policy,
      fakeProvider("providerTwo", {
        ...allCapabilities,
        thinking: false
      }),
      {},
      { telemetry }
    );

    expect(capabilities).toEqual({});
    expect(telemetry.events.filter((event) => event.type === "thinking_overridden")).toHaveLength(0);
  });

  it("fails clearly for invalid provider override thinking values", () => {
    const parsed = modelPolicySchema.safeParse({
      modelId: "kimi-k2-6",
      repairs: [],
      effectiveContextTokens: 96000,
      providerOverrides: [
        {
          providerId: "providerOne",
          thinking: "sometimes"
        }
      ]
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }

    const issueText = JSON.stringify(parsed.error.issues);
    expect(issueText).toContain("providerOverrides");
    expect(issueText).toContain("thinking");
    expect(issueText).toContain("enabled");
    expect(issueText).toContain("disabled");
    expect(issueText).toContain("unchanged");
  });

  it("emits inspection warnings for unknown provider override references", () => {
    const summary = summarizeModelPolicyForInspection({
      modelId: "kimi-k2-6",
      repairs: ["bareStringToArray"],
      effectiveContextTokens: 96000,
      providerOverrides: [
        {
          providerId: "providerThree",
          thinking: "disabled"
        }
      ]
    });

    expect(summary.valid).toBe(true);
    expect(summary.warnings).toContainEqual({
      code: "unknown_provider_override",
      path: "providerOverrides[0].providerId",
      message: "Provider override references unknown providerId providerThree."
    });
  });

  it("emits inspection warnings for duplicate provider override entries", () => {
    const summary = summarizeModelPolicyForInspection({
      modelId: "kimi-k2-6",
      repairs: ["bareStringToArray"],
      effectiveContextTokens: 96000,
      providerOverrides: [
        {
          providerId: "providerOne",
          thinking: "disabled"
        },
        {
          providerId: "providerOne",
          thinking: "enabled"
        }
      ]
    });

    expect(summary.valid).toBe(true);
    expect(summary.warnings).toContainEqual({
      code: "duplicate_provider_override",
      path: "providerOverrides[1].providerId",
      message: "Duplicate provider override for providerOne; first entry is at providerOverrides[0]."
    });
  });
});

function fakeProvider(
  id: ProviderId,
  capabilities: Required<CapabilityFlags> = allCapabilities
): ProviderAdapter {
  return {
    id,
    supportedModels: ["kimi-k2-6", "deepseek-v4-pro", "deepseek-flash"] as CanonicalModelId[],
    capabilities,
    async completeChat(_request: ProviderChatRequest): Promise<ProviderChatResponse> {
      return { content: `ok from ${id}` };
    }
  };
}
