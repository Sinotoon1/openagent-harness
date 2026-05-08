import "./helpers/setup.js";
import { describe, expect, it, vi } from "vitest";
import { callOssChat, createOpenAIProvider, makeRegisteredToolsWithProviders } from "./helpers/providers.js";
import { jsonResponse, sseData, sseResponse, textResponse } from "./helpers/providerResponses.js";

describe("MCP tools", () => {
  describe("oss_chat success response shaping", () => {
    it("returns clean non-streaming output without the full raw provider payload by default", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            id: "chatcmpl-raw-success-id",
            choices: [
              {
                finish_reason: "stop",
                message: { content: "safe model answer" }
              }
            ],
            usage: {
              prompt_tokens: 3,
              completion_tokens: 4,
              total_tokens: 7
            },
            provider_internal_trace: "raw-success-trace-123"
          })
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });
      const body = JSON.parse(responseText) as {
        modelId: string;
        providerId: string;
        content: string;
        usage: Record<string, number>;
        finishReason: string;
        raw?: unknown;
        rawProviderResponsePreview?: unknown;
      };

      expect(body).toMatchObject({
        modelId: "kimi-k2-6",
        providerId: "deepseekPrimary",
        content: "safe model answer",
        usage: {
          prompt_tokens: 3,
          completion_tokens: 4,
          total_tokens: 7
        },
        finishReason: "stop"
      });
      expect(body.raw).toBeUndefined();
      expect(body.rawProviderResponsePreview).toBeUndefined();
      expect(responseText).not.toContain("chatcmpl-raw-success-id");
      expect(responseText).not.toContain("raw-success-trace-123");
    });

    it("returns clean streaming output without the full raw provider payload by default", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sseResponse([
            sseData({
              choices: [
                {
                  delta: { content: "streamed" },
                  provider_internal_trace: "stream-raw-trace-456"
                }
              ]
            }),
            sseData({
              choices: [{ delta: { content: " answer" }, finish_reason: "stop" }]
            }),
            "data: [DONE]\n\n"
          ])
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        streaming: { enabled: true }
      });
      const body = JSON.parse(responseText) as {
        content: string;
        finishReason: string;
        raw?: unknown;
        rawProviderResponsePreview?: unknown;
      };

      expect(body.content).toBe("streamed answer");
      expect(body.finishReason).toBe("stop");
      expect(body.raw).toBeUndefined();
      expect(body.rawProviderResponsePreview).toBeUndefined();
      expect(responseText).not.toContain("stream-raw-trace-456");
      expect(responseText).not.toContain("chunks");
    });

    it("returns only a sanitized bounded raw provider preview when explicitly requested", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            id: "chatcmpl-debug-preview-id",
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "debug model answer"
                }
              }
            ],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 5,
              total_tokens: 10
            },
            prompt: "private prompt that must not be returned raw",
            messages: [{ role: "user", content: "private message body" }],
            headers: {
              authorization: "Bearer raw-header-token-12345"
            },
            env: {
              PROVIDER_API_KEY: "raw-env-secret-value"
            },
            metadata: {
              note: "Bearer raw-secret-shaped-value",
              longValue: "x".repeat(250)
            },
            tool_calls: [
              {
                function: {
                  name: "run",
                  arguments: "deploy --token raw-tool-call-token"
                }
              }
            ],
            largeArray: [1, 2, 3, 4, 5, 6, 7],
            nested: {
              a: {
                b: {
                  c: {
                    d: {
                      e: "too deep"
                    }
                  }
                }
              }
            }
          })
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        includeRawProviderResponse: true
      });
      const body = JSON.parse(responseText) as {
        content: string;
        raw?: unknown;
        rawProviderResponsePreview?: {
          choices?: Array<{ message?: { content?: string } }>;
          prompt?: string;
          messages?: string;
          headers?: string;
          env?: string;
          metadata?: { note?: string; longValue?: string };
          tool_calls?: Array<{ function?: { arguments?: string } }>;
          largeArray?: unknown[];
          nested?: unknown;
        };
      };

      expect(body.content).toBe("debug model answer");
      expect(body.raw).toBeUndefined();
      expect(body.rawProviderResponsePreview).toBeDefined();
      expect(body.rawProviderResponsePreview?.choices?.[0]?.message?.content).toMatch(
        /^<summarized:content:/
      );
      expect(body.rawProviderResponsePreview?.prompt).toMatch(/^<summarized:prompt:/);
      expect(body.rawProviderResponsePreview?.messages).toMatch(/^<summarized:messages:/);
      expect(body.rawProviderResponsePreview?.headers).toMatch(/^<summarized:headers:/);
      expect(body.rawProviderResponsePreview?.env).toMatch(/^<summarized:env:/);
      expect(body.rawProviderResponsePreview?.metadata?.note).toBe("<redacted>");
      expect(body.rawProviderResponsePreview?.metadata?.longValue).toContain("<truncated:");
      expect(body.rawProviderResponsePreview?.tool_calls?.[0]?.function?.arguments).toMatch(
        /^<summarized:arguments:/
      );
      expect(body.rawProviderResponsePreview?.largeArray).toContain("<omitted:2:items>");
      expect(JSON.stringify(body.rawProviderResponsePreview?.nested)).toContain(
        "<omitted:max-depth>"
      );
      expect(responseText).not.toContain("private prompt that must not be returned raw");
      expect(responseText).not.toContain("private message body");
      expect(responseText).not.toContain("raw-header-token-12345");
      expect(responseText).not.toContain("raw-env-secret-value");
      expect(responseText).not.toContain("raw-secret-shaped-value");
      expect(responseText).not.toContain("raw-tool-call-token");
      expect(responseText).not.toContain("too deep");
    });

    it("summarizes raw provider data containers in explicit debug previews", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            id: "chatcmpl-safe-metadata-id",
            model: "deepseek-v4-pro",
            created: 1234567890,
            object: "chat.completion",
            status: "completed",
            choices: [
              {
                finish_reason: "stop",
                message: { content: "container-safe answer" }
              }
            ],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 3,
              total_tokens: 5
            },
            data: "User prompt: private data prompt leak marker data-leak-001",
            response: {
              text: "User prompt: private response prompt leak marker response-leak-002"
            },
            debug: [
              "User prompt: private debug prompt leak marker debug-leak-003"
            ],
            raw: {
              note: "raw provider marker raw-note-leak-004",
              token: "Bearer raw-debug-token-12345"
            }
          })
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        includeRawProviderResponse: true
      });
      const body = JSON.parse(responseText) as {
        providerId: string;
        content: string;
        usage: Record<string, number>;
        finishReason: string;
        rawProviderResponsePreview?: {
          id?: string;
          model?: string;
          created?: number;
          object?: string;
          status?: string;
          usage?: Record<string, number>;
          data?: string;
          response?: string;
          debug?: string;
          raw?: string;
        };
      };

      expect(body.providerId).toBe("deepseekPrimary");
      expect(body.content).toBe("container-safe answer");
      expect(body.usage).toEqual({
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5
      });
      expect(body.finishReason).toBe("stop");
      expect(body.rawProviderResponsePreview).toMatchObject({
        id: "chatcmpl-safe-metadata-id",
        model: "deepseek-v4-pro",
        created: 1234567890,
        object: "chat.completion",
        status: "completed",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5
        },
        data: expect.stringMatching(/^<summarized:data:/),
        response: expect.stringMatching(/^<summarized:response:/),
        debug: expect.stringMatching(/^<summarized:debug:/),
        raw: expect.stringMatching(/^<summarized:raw:/)
      });
      expect(responseText).not.toContain("data-leak-001");
      expect(responseText).not.toContain("response-leak-002");
      expect(responseText).not.toContain("debug-leak-003");
      expect(responseText).not.toContain("raw-note-leak-004");
      expect(responseText).not.toContain("raw-debug-token-12345");
    });

    it("summarizes nested raw data response and debug fields in explicit debug previews", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({
            choices: [
              {
                finish_reason: "stop",
                message: { content: "nested-safe answer" }
              }
            ],
            wrapper: {
              data: {
                promptText: "private nested data prompt nested-data-leak-001"
              },
              child: {
                response: "private nested response prompt nested-response-leak-002",
                deeper: {
                  debug: {
                    trace: "private nested debug prompt nested-debug-leak-003"
                  },
                  raw: {
                    note: "private nested raw marker nested-raw-leak-004",
                    apiKey: "raw-nested-api-key"
                  }
                }
              }
            }
          })
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        includeRawProviderResponse: true
      });
      const body = JSON.parse(responseText) as {
        content: string;
        rawProviderResponsePreview?: {
          wrapper?: {
            data?: string;
            child?: {
              response?: string;
              deeper?: {
                debug?: string;
                raw?: string;
              };
            };
          };
        };
      };

      expect(body.content).toBe("nested-safe answer");
      expect(body.rawProviderResponsePreview?.wrapper?.data).toMatch(
        /^<summarized:data:/
      );
      expect(body.rawProviderResponsePreview?.wrapper?.child?.response).toMatch(
        /^<summarized:response:/
      );
      expect(body.rawProviderResponsePreview?.wrapper?.child?.deeper?.debug).toMatch(
        /^<summarized:debug:/
      );
      expect(body.rawProviderResponsePreview?.wrapper?.child?.deeper?.raw).toMatch(
        /^<summarized:raw:/
      );
      expect(responseText).not.toContain("nested-data-leak-001");
      expect(responseText).not.toContain("nested-response-leak-002");
      expect(responseText).not.toContain("nested-debug-leak-003");
      expect(responseText).not.toContain("nested-raw-leak-004");
      expect(responseText).not.toContain("raw-nested-api-key");
    });
  });

  describe("oss_chat provider error sanitization", () => {
    it("does not return non-streaming HTTP error bodies through oss_chat", async () => {
      const rawBody = "plain provider body with customer metadata raw-body-123";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 500))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });

      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 500");
      expect(responseText).not.toContain(rawBody);
      expect(responseText).not.toContain("raw-body-123");
    });

    it("does not return streaming HTTP error bodies before first token", async () => {
      const rawBody = "stream setup failed with raw provider body stream-leak-456";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 503))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 503");
      expect(responseText).toContain("before_first_token");
      expect(responseText).not.toContain(rawBody);
      expect(responseText).not.toContain("stream-leak-456");
    });

    it("does not return provider body text from after-first-token stream failures", async () => {
      const rawStreamError = "provider_error_body: internal prompt fragment stream-leak-789";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          sseResponse([
            sseData({ choices: [{ delta: { content: "partial" } }] }),
            `data: ${rawStreamError}\n\n`
          ])
        )
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider deepseekPrimary stream failed after assistant output started");
      expect(responseText).not.toContain(rawStreamError);
      expect(responseText).not.toContain("stream-leak-789");
    });

    it("does not return raw prompt-like provider HTTP bodies", async () => {
      const rawBody = "User prompt: summarize this private roadmap and prior messages.";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 500))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });

      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 500");
      expect(responseText).not.toContain("User prompt");
      expect(responseText).not.toContain("private roadmap");
      expect(responseText).not.toContain("prior messages");
    });

    it("does not return raw header-like or env-like provider HTTP bodies", async () => {
      const rawBody =
        "X-Internal-Trace: trace-abc-123\nDEEPSEEK_PRIMARY_BASE_URL=https://internal.example";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 502))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });

      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 502");
      expect(responseText).not.toContain("X-Internal-Trace");
      expect(responseText).not.toContain("trace-abc-123");
      expect(responseText).not.toContain("DEEPSEEK_PRIMARY_BASE_URL");
      expect(responseText).not.toContain("internal.example");
    });

    it("does not return secret-shaped provider HTTP bodies", async () => {
      const rawBody = "provider said Authorization: Bearer raw-provider-token-12345";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 500))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });

      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 500");
      expect(responseText).not.toContain("raw-provider-token-12345");
      expect(responseText).not.toContain("Authorization");
      expect(responseText).not.toContain("<redacted>");
    });

    it("keeps provider id, HTTP status, phase, and retryability in safe errors", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse("raw body should be omitted", 429))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["deepseekPrimary"] });

      expect(responseText).toContain("deepseekPrimary");
      expect(responseText).toContain("HTTP 429");
      expect(responseText).toContain("before_first_token");
      expect(responseText).toContain("retryable");
      expect(responseText).not.toContain("raw body should be omitted");
    });

    it("still falls back for retryable HTTP errors before first token", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://deepseek-primary.example")) {
          return textResponse("raw body from first provider fallback-leak", 500);
        }
        return jsonResponse({
          choices: [{ message: { content: "fallback answer" } }]
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { handlers, telemetry } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1"),
        createOpenAIProvider("openrouterFallback", "https://openrouter-fallback.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary", "openrouterFallback"]
      });

      expect(responseText).toContain('"providerId": "openrouterFallback"');
      expect(responseText).toContain("Provider deepseekPrimary returned HTTP 500");
      expect(responseText).not.toContain("fallback-leak");
      expect(JSON.stringify(telemetry.getEvents())).not.toContain("fallback-leak");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("still does not fallback after first streamed token", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://openrouter-fallback.example")) {
          return jsonResponse({
            choices: [{ message: { content: "must not be used" } }]
          });
        }
        return sseResponse([
          sseData({ choices: [{ delta: { content: "partial" } }] }),
          "data: provider_error_body after token no-fallback-leak\n\n"
        ]);
      });
      vi.stubGlobal("fetch", fetchMock);
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("deepseekPrimary", "https://deepseek-primary.example/v1"),
        createOpenAIProvider("openrouterFallback", "https://openrouter-fallback.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["deepseekPrimary", "openrouterFallback"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider deepseekPrimary stream failed after assistant output started");
      expect(responseText).not.toContain("must not be used");
      expect(responseText).not.toContain("no-fallback-leak");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
