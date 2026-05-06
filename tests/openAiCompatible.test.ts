import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeConfig } from "../src/providers/config.js";
import { OpenAICompatibleProviderAdapter } from "../src/providers/openAiCompatible.js";
import { ProviderError } from "../src/providers/providerError.js";
import { ChatRouter } from "../src/router/chatRouter.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import type { CapabilityFlags, ProviderId } from "../src/types.js";

const allCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

const providerConfig = (id: ProviderId): ProviderRuntimeConfig => ({
  id,
  stickySession: {
    header: "X-Session-Id",
    strategy: "raw"
  }
});

const createProvider = (id: ProviderId, baseUrl: string) =>
  new OpenAICompatibleProviderAdapter({
    id,
    baseUrl,
    providerConfig: providerConfig(id),
    capabilities: allCapabilities,
    modelSlugs: {
      "kimi-k2-6": `${id}-kimi`
    }
  });

const chatRequest = {
  modelId: "kimi-k2-6" as const,
  sessionId: "session-a",
  messages: [{ role: "user" as const, content: "hello" }],
  capabilities: {}
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAICompatibleProviderAdapter", () => {
  it("keeps non-streaming request behavior compatible", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream: boolean };
      expect(body.stream).toBe(false);
      return jsonResponse({
        choices: [{ message: { content: "non-streamed answer" } }]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.completeChat(chatRequest);

    expect(result.content).toBe("non-streamed answer");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("streams multiple content chunks until [DONE]", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream: boolean };
      expect(body.stream).toBe(true);
      return sseResponse([
        sseData({ choices: [{ delta: { content: "Hello" } }] }),
        sseData({ choices: [{ delta: { content: " world" } }] }),
        "data: [DONE]\n\n"
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("Hello world");
    expect(result.raw).toMatchObject({
      streamed: true
    });
  });

  it("collects tool-call deltas as meaningful streaming output", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [{ id: "call_1", function: { name: "lookup" } }]
                }
              }
            ]
          }),
          "data: [DONE]\n\n"
        ])
      )
    );

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("");
    expect(result.raw).toMatchObject({
      toolCallDeltas: [[{ id: "call_1", function: { name: "lookup" } }]]
    });
  });

  it("returns collected content when stream EOF arrives without [DONE]", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({ choices: [{ delta: { content: "partial but complete enough" } }] })
        ])
      )
    );

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("partial but complete enough");
    expect(result.raw).toMatchObject({
      streamed: true
    });
  });

  it("returns an empty string for empty streaming output", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(["data: [DONE]\n\n"])));

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("");
    expect(result.raw).toMatchObject({
      chunks: [],
      streamed: true
    });
  });

  it("ignores SSE comment lines", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          ": provider heartbeat\n\n",
          sseData({ choices: [{ delta: { content: "after comment" } }] }),
          "data: [DONE]\n\n"
        ])
      )
    );

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("after comment");
  });

  it("does not support SSE multi-line data JSON events", async () => {
    const provider = createProvider("providerOne", "https://provider-one.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"split\n',
          'data: json"}}]}\n\n'
        ])
      )
    );

    await expect(
      provider.completeChat({
        ...chatRequest,
        streaming: { enabled: true }
      })
    ).rejects.toMatchObject({
      fallbackPhase: "before_first_token"
    });
  });
});

describe("streaming fallback semantics", () => {
  it("falls back when provider request fails before first token", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const providerOne = createProvider("providerOne", "https://provider-one.example/v1");
    const providerTwo = createProvider("providerTwo", "https://provider-two.example/v1");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://provider-one.example")) {
        throw new Error("network unavailable");
      }
      return sseResponse([sseData({ choices: [{ delta: { content: "fallback" } }] })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter([providerOne, providerTwo], telemetry);
    const result = await router.route({
      ...chatRequest,
      providerPriority: ["providerOne", "providerTwo"],
      streaming: { enabled: true }
    });

    expect(result.providerId).toBe("providerTwo");
    expect(result.content).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(telemetry.events).toContainEqual(
      expect.objectContaining({
        type: "provider_fallback",
        metadata: expect.objectContaining({
          fallbackPhase: "before_first_token"
        })
      })
    );
  });

  it("does not fallback when provider stream fails after first token", async () => {
    const providerOne = createProvider("providerOne", "https://provider-one.example/v1");
    const providerTwo = createProvider("providerTwo", "https://provider-two.example/v1");
    const fetchMock = vi.fn(async () =>
      sseResponse(
        [
          sseData({ choices: [{ delta: { content: "partial" } }] }),
          "data: {not-json}\n\n"
        ]
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter(
      [providerOne, providerTwo],
      new InMemoryTelemetrySink()
    );

    await expect(
      router.route({
        ...chatRequest,
        providerPriority: ["providerOne", "providerTwo"],
        streaming: { enabled: true }
      })
    ).rejects.toMatchObject({
      retryable: true,
      fallbackPhase: "after_first_token",
      partialContent: "partial"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back on malformed SSE before first token", async () => {
    const providerOne = createProvider("providerOne", "https://provider-one.example/v1");
    const providerTwo = createProvider("providerTwo", "https://provider-two.example/v1");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://provider-one.example")) {
        return sseResponse(["data: {not-json}\n\n"]);
      }
      return sseResponse([sseData({ choices: [{ delta: { content: "recovered" } }] })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter(
      [providerOne, providerTwo],
      new InMemoryTelemetrySink()
    );
    const result = await router.route({
      ...chatRequest,
      providerPriority: ["providerOne", "providerTwo"],
      streaming: { enabled: true }
    });

    expect(result.providerId).toBe("providerTwo");
    expect(result.content).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fallback on malformed SSE after first token", async () => {
    const providerOne = createProvider("providerOne", "https://provider-one.example/v1");
    const providerTwo = createProvider("providerTwo", "https://provider-two.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({ choices: [{ delta: { content: "visible" } }] }),
          "data: {not-json}\n\n"
        ])
      )
    );

    const router = new ChatRouter(
      [providerOne, providerTwo],
      new InMemoryTelemetrySink()
    );

    await expect(
      router.route({
        ...chatRequest,
        providerPriority: ["providerOne", "providerTwo"],
        streaming: { enabled: true }
      })
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
