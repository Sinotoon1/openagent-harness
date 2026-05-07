import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/providers/providerError.js";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse
} from "../src/providers/types.js";
import type { ProviderRuntimeConfig } from "../src/providers/config.js";
import { buildStickySessionHeaders } from "../src/providers/session.js";
import { ChatRouter } from "../src/router/chatRouter.js";
import { negotiateCapabilities } from "../src/router/capabilities.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import type { CapabilityFlags, CanonicalModelId, ProviderId } from "../src/types.js";

class FakeProvider implements ProviderAdapter {
  readonly supportedModels: CanonicalModelId[] = [
    "kimi-k2-6",
    "deepseek-v4-pro",
    "deepseek-flash"
  ];
  readonly calls: ProviderChatRequest[] = [];

  constructor(
    readonly id: ProviderId,
    readonly capabilities: Required<CapabilityFlags>,
    private readonly behavior:
      | "success"
      | "retryableFailure"
      | "nonRetryableFailure"
      | "afterFirstTokenFailure" = "success"
  ) {}

  async completeChat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    this.calls.push(request);
    if (this.behavior === "retryableFailure") {
      throw new ProviderError(`${this.id} temporarily unavailable`, {
        retryable: true,
        providerId: this.id
      });
    }
    if (this.behavior === "nonRetryableFailure") {
      throw new ProviderError(`${this.id} rejected request`, {
        retryable: false,
        providerId: this.id
      });
    }
    if (this.behavior === "afterFirstTokenFailure") {
      throw new ProviderError(`${this.id} stream failed after first token`, {
        retryable: true,
        providerId: this.id,
        fallbackPhase: "after_first_token"
      });
    }
    return { content: `ok from ${this.id}` };
  }
}

const allCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

describe("ChatRouter", () => {
  it("falls back in provider priority order on retryable failures", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider(
      "providerOne",
      allCapabilities,
      "retryableFailure"
    );
    const providerTwo = new FakeProvider("providerTwo", allCapabilities);
    const router = new ChatRouter([providerOne, providerTwo], telemetry);

    const result = await router.route({
      modelId: "kimi-k2-6",
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerOne", "providerTwo"]
    });

    expect(result.providerId).toBe("providerTwo");
    expect(result.attempts.map((attempt) => attempt.providerId)).toEqual([
      "providerOne",
      "providerTwo"
    ]);
    expect(telemetry.events.some((event) => event.type === "provider_fallback")).toBe(true);
  });

  it("keeps primary provider capabilities when fallback providers lack them", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider("providerOne", allCapabilities);
    const providerTwo = new FakeProvider("providerTwo", {
      zeroDataRetention: false,
      disallowPromptTraining: true,
      thinking: true
    });
    const router = new ChatRouter([providerOne, providerTwo], telemetry);

    const result = await router.route({
      modelId: "kimi-k2-6",
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerOne", "providerTwo"],
      capabilities: {
        zeroDataRetention: true,
        disallowPromptTraining: true
      }
    });

    expect(result.providerId).toBe("providerOne");
    expect(result.capabilities).toEqual({
      zeroDataRetention: true,
      disallowPromptTraining: true
    });
    expect(result.droppedCapabilities).toEqual([]);
    expect(providerOne.calls[0]?.capabilities).toEqual({
      zeroDataRetention: true,
      disallowPromptTraining: true
    });
    expect(providerTwo.calls).toHaveLength(0);
  });

  it("renegotiates capabilities on fallback and drops only unsupported flags", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider(
      "providerOne",
      allCapabilities,
      "retryableFailure"
    );
    const providerTwo = new FakeProvider("providerTwo", {
      zeroDataRetention: false,
      disallowPromptTraining: true,
      thinking: true
    });
    const router = new ChatRouter([providerOne, providerTwo], telemetry);

    const result = await router.route({
      modelId: "kimi-k2-6",
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerOne", "providerTwo"],
      capabilities: {
        zeroDataRetention: true,
        disallowPromptTraining: true
      }
    });

    expect(result.providerId).toBe("providerTwo");
    expect(providerOne.calls[0]?.capabilities).toEqual({
      zeroDataRetention: true,
      disallowPromptTraining: true
    });
    expect(providerTwo.calls[0]?.capabilities).toEqual({
      disallowPromptTraining: true
    });
    expect(result.capabilities).toEqual({
      disallowPromptTraining: true
    });
    expect(result.droppedCapabilities).toEqual(["zeroDataRetention"]);
  });

  it("drops multiple unsupported capabilities independently for one provider attempt", () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerTwo = new FakeProvider("providerTwo", {
      zeroDataRetention: false,
      disallowPromptTraining: true,
      thinking: false
    });

    const result = negotiateCapabilities(
      {
        zeroDataRetention: true,
        disallowPromptTraining: true,
        thinking: true
      },
      providerTwo,
      {
        telemetry,
        sessionId: "s1",
        modelId: "deepseek-flash",
        attemptIndex: 1
      }
    );

    expect(result.capabilities).toEqual({
      disallowPromptTraining: true
    });
    expect(result.droppedCapabilities).toEqual(["zeroDataRetention", "thinking"]);
    expect(telemetry.events).toMatchObject([
      {
        type: "capability_dropped",
        providerId: "providerTwo",
        capability: "zeroDataRetention",
        metadata: {
          reason: "unsupported_by_provider",
          attemptIndex: 1
        }
      },
      {
        type: "capability_dropped",
        providerId: "providerTwo",
        capability: "thinking"
      }
    ]);
  });

  it("overrides thinking for deepseek-v4-pro on providerTwo", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerTwo = new FakeProvider("providerTwo", allCapabilities);
    const router = new ChatRouter([providerTwo], telemetry);

    const result = await router.route({
      modelId: "deepseek-v4-pro",
      sessionId: "s1",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerTwo"],
      capabilities: { thinking: true }
    });

    expect(result.capabilities.thinking).toBeUndefined();
    expect(providerTwo.calls[0]?.capabilities.thinking).toBeUndefined();
    expect(telemetry.events.filter((event) => event.type === "thinking_overridden")).toMatchObject([
      {
        modelId: "deepseek-v4-pro",
        providerId: "providerTwo",
        capability: "thinking",
        metadata: {
          reason: "deepseek-v4-pro on providerTwo must run with thinking disabled",
          source: "model_policy",
          override: "thinking_disabled",
          attemptIndex: 0
        }
      }
    ]);
  });

  it("does not override thinking for deepseek-v4-pro on providerOne", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider("providerOne", allCapabilities);
    const router = new ChatRouter([providerOne], telemetry);

    const result = await router.route({
      modelId: "deepseek-v4-pro",
      sessionId: "s2",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerOne"],
      capabilities: { thinking: true }
    });

    expect(result.capabilities.thinking).toBe(true);
    expect(providerOne.calls[0]?.capabilities.thinking).toBe(true);
    expect(telemetry.events.filter((event) => event.type === "thinking_overridden")).toHaveLength(0);
  });

  it("does not apply the DeepSeek providerTwo override to kimi-k2-6", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerTwo = new FakeProvider("providerTwo", allCapabilities);
    const router = new ChatRouter([providerTwo], telemetry);

    const result = await router.route({
      modelId: "kimi-k2-6",
      sessionId: "s3",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerTwo"],
      capabilities: { thinking: true }
    });

    expect(result.capabilities.thinking).toBe(true);
    expect(providerTwo.calls[0]?.capabilities.thinking).toBe(true);
    expect(telemetry.events.filter((event) => event.type === "thinking_overridden")).toHaveLength(0);
  });

  it("emits likely cold then warm cache telemetry for repeated session/model/provider", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider("providerOne", allCapabilities);
    const router = new ChatRouter([providerOne], telemetry);
    const input = {
      modelId: "kimi-k2-6" as const,
      sessionId: "s1",
      messages: [{ role: "user" as const, content: "hello" }],
      providerPriority: ["providerOne" as const]
    };

    await router.route(input);
    await router.route(input);

    expect(telemetry.events.map((event) => event.type)).toContain("cache_likely_cold");
    expect(telemetry.events.map((event) => event.type)).toContain("cache_likely_warm");
  });

  it("does not switch providers after the first streamed token boundary", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = new FakeProvider(
      "providerOne",
      allCapabilities,
      "afterFirstTokenFailure"
    );
    const providerTwo = new FakeProvider("providerTwo", allCapabilities);
    const router = new ChatRouter([providerOne, providerTwo], telemetry);

    await expect(
      router.route({
        modelId: "kimi-k2-6",
        sessionId: "s1",
        messages: [{ role: "user", content: "hello" }],
        providerPriority: ["providerOne", "providerTwo"],
        streaming: { enabled: true }
      })
    ).rejects.toMatchObject({
      fallbackPhase: "after_first_token"
    });

    expect(providerTwo.calls).toHaveLength(0);
    expect(telemetry.events.some((event) => event.type === "provider_fallback")).toBe(false);
  });
});

describe("session pinning", () => {
  const rawConfig: ProviderRuntimeConfig = {
    id: "providerOne",
    stickySession: {
      header: "X-Session-Id",
      strategy: "raw"
    }
  };
  const hashConfig: ProviderRuntimeConfig = {
    id: "providerTwo",
    stickySession: {
      header: "X-Routing-Key",
      strategy: "hash"
    }
  };

  it("uses the configured raw sticky session header", () => {
    expect(buildStickySessionHeaders(rawConfig, "session-a")).toEqual({
      "X-Session-Id": "session-a"
    });
  });

  it("uses the configured hash sticky session header", () => {
    const first = buildStickySessionHeaders(hashConfig, "session-a");
    const second = buildStickySessionHeaders(hashConfig, "session-a");

    expect(first).toEqual(second);
    expect(first["X-Routing-Key"]).toMatch(/^[a-f0-9]{32}$/);
    expect(first["X-Routing-Key"]).not.toBe("session-a");
  });
});
