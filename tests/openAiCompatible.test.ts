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
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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

  it("reconstructs a single tool call from one delta", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "lookup", arguments: "{\"city\":\"Paris\"}" }
                    }
                  ]
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
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"city\":\"Paris\"}" }
      }
    ]);
    expect(result.raw).toMatchObject({
      toolCallDeltas: [
        [
          {
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{\"city\":\"Paris\"}" }
          }
        ]
      ]
    });
  });

  it("reconstructs tool-call arguments split across multiple deltas", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "lookup", arguments: "{\"city\":" }
                    }
                  ]
                }
              }
            ]
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: "\"Paris\"}" } }]
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

    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"city\":\"Paris\"}" }
      }
    ]);
  });

  it("reconstructs a function name split across multiple deltas", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "look" }
                    }
                  ]
                }
              }
            ]
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { name: "up", arguments: "{\"q\":\"x\"}" } }
                  ]
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

    expect(result.toolCalls?.[0]?.function).toEqual({
      name: "lookup",
      arguments: "{\"q\":\"x\"}"
    });
  });

  it("reconstructs multiple interleaved tool calls by index", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 1,
                      id: "call_b",
                      type: "function",
                      function: { name: "write", arguments: "{\"path\":" }
                    },
                    {
                      index: 0,
                      id: "call_a",
                      type: "function",
                      function: { name: "read", arguments: "{\"path\":" }
                    }
                  ]
                }
              }
            ]
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: "\"a.ts\"}" } },
                    { index: 1, function: { arguments: "\"b.ts\"}" } }
                  ]
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

    expect(result.toolCalls).toEqual([
      {
        id: "call_a",
        type: "function",
        function: { name: "read", arguments: "{\"path\":\"a.ts\"}" }
      },
      {
        id: "call_b",
        type: "function",
        function: { name: "write", arguments: "{\"path\":\"b.ts\"}" }
      }
    ]);
  });

  it("preserves content mixed with tool-call deltas", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({ choices: [{ delta: { content: "I will " } }] }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "lookup", arguments: "{\"q\":\"docs\"}" }
                    }
                  ]
                }
              }
            ]
          }),
          sseData({ choices: [{ delta: { content: "check." } }] }),
          "data: [DONE]\n\n"
        ])
      )
    );

    const result = await provider.completeChat({
      ...chatRequest,
      streaming: { enabled: true }
    });

    expect(result.content).toBe("I will check.");
    expect(result.toolCalls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "lookup", arguments: "{\"q\":\"docs\"}" }
      }
    ]);
  });

  it("does not crash on empty, malformed, or partial tool-call deltas", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          sseData({ choices: [{ delta: { tool_calls: [] } }] }),
          sseData({ choices: [{ delta: { tool_calls: [null, "bad"] } }] }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: "call_partial" }]
                }
              }
            ]
          }),
          sseData({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: "{\"partial\":true}" } }]
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

    expect(result.toolCalls).toEqual([
      {
        id: "call_partial",
        type: "function",
        function: { name: "", arguments: "{\"partial\":true}" }
      }
    ]);
  });

  it("returns collected content when stream EOF arrives without [DONE]", async () => {
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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
    const provider = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
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
    const deepseekPrimary = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    const openrouterFallback = createProvider("openrouterFallback", "https://openrouter-fallback.example/v1");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://deepseek-primary.example")) {
        throw new Error("network unavailable");
      }
      return sseResponse([sseData({ choices: [{ delta: { content: "fallback" } }] })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter([deepseekPrimary, openrouterFallback], telemetry);
    const result = await router.route({
      ...chatRequest,
      providerPriority: ["deepseekPrimary", "openrouterFallback"],
      streaming: { enabled: true }
    });

    expect(result.providerId).toBe("openrouterFallback");
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
    const deepseekPrimary = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    const openrouterFallback = createProvider("openrouterFallback", "https://openrouter-fallback.example/v1");
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
      [deepseekPrimary, openrouterFallback],
      new InMemoryTelemetrySink()
    );

    await expect(
      router.route({
        ...chatRequest,
        providerPriority: ["deepseekPrimary", "openrouterFallback"],
        streaming: { enabled: true }
      })
    ).rejects.toMatchObject({
      retryable: true,
      fallbackPhase: "after_first_token",
      partialContent: "partial"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fallback when provider stream fails after a tool-call delta", async () => {
    const deepseekPrimary = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    const openrouterFallback = createProvider("openrouterFallback", "https://openrouter-fallback.example/v1");
    const fetchMock = vi.fn(async () =>
      sseResponse([
        sseData({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: { name: "lookup", arguments: "{\"q\":\"docs\"}" }
                  }
                ]
              }
            }
          ]
        }),
        "data: {not-json}\n\n"
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter(
      [deepseekPrimary, openrouterFallback],
      new InMemoryTelemetrySink()
    );

    await expect(
      router.route({
        ...chatRequest,
        providerPriority: ["deepseekPrimary", "openrouterFallback"],
        streaming: { enabled: true }
      })
    ).rejects.toMatchObject({
      retryable: true,
      fallbackPhase: "after_first_token",
      partialContent: ""
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back on malformed SSE before first token", async () => {
    const deepseekPrimary = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    const openrouterFallback = createProvider("openrouterFallback", "https://openrouter-fallback.example/v1");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://deepseek-primary.example")) {
        return sseResponse(["data: {not-json}\n\n"]);
      }
      return sseResponse([sseData({ choices: [{ delta: { content: "recovered" } }] })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = new ChatRouter(
      [deepseekPrimary, openrouterFallback],
      new InMemoryTelemetrySink()
    );
    const result = await router.route({
      ...chatRequest,
      providerPriority: ["deepseekPrimary", "openrouterFallback"],
      streaming: { enabled: true }
    });

    expect(result.providerId).toBe("openrouterFallback");
    expect(result.content).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fallback on malformed SSE after first token", async () => {
    const deepseekPrimary = createProvider("deepseekPrimary", "https://deepseek-primary.example/v1");
    const openrouterFallback = createProvider("openrouterFallback", "https://openrouter-fallback.example/v1");
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
      [deepseekPrimary, openrouterFallback],
      new InMemoryTelemetrySink()
    );

    await expect(
      router.route({
        ...chatRequest,
        providerPriority: ["deepseekPrimary", "openrouterFallback"],
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
