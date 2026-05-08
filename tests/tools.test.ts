import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChatRouter } from "../src/router/chatRouter.js";
import { OpenAICompatibleProviderAdapter } from "../src/providers/openAiCompatible.js";
import type { ProviderRuntimeConfig } from "../src/providers/config.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { registerTools } from "../src/tools/index.js";
import { JsonlTelemetrySink } from "../src/telemetry/jsonl.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import { createReviewableRepairPolicySuggestions } from "../src/telemetry/repairPolicySuggestions.js";
import { hashSessionId, hashSessionIdWithSalt } from "../src/security/sessionHash.js";
import type { TelemetrySink } from "../src/telemetry/types.js";
import type { CapabilityFlags, ProviderId } from "../src/types.js";

type ToolHandler = (input: unknown) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRegisteredTools(
  telemetry: TelemetrySink = new InMemoryTelemetrySink(),
  router: ChatRouter = {} as ChatRouter
) {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    }
  } as unknown as McpServer;

  registerTools(server, {
    router,
    telemetry
  });

  return { handlers, telemetry };
}

function parseToolResult(result: Awaited<ReturnType<ToolHandler>>): unknown {
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

function callerPathBatchDescriptor(toolName = "callerPathBatch") {
  return {
    toolName,
    schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" }
        },
        label: {
          type: "string",
          optional: true
        }
      },
      required: ["paths"]
    },
    pathStringArrayFields: ["paths"]
  };
}

function descriptorWithField(field: string) {
  return {
    toolName: "dangerousDescriptor",
    schema: {
      type: "object",
      properties: Object.fromEntries([[field, { type: "string" }]])
    }
  };
}

describe("MCP tools", () => {
  it("registers get_harness_stats", () => {
    const { handlers } = makeRegisteredTools();

    expect(handlers.has("get_harness_stats")).toBe(true);
  });

  describe("oss_chat provider error sanitization", () => {
    it("does not return non-streaming HTTP error bodies through oss_chat", async () => {
      const rawBody = "plain provider body with customer metadata raw-body-123";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 500))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["providerOne"] });

      expect(responseText).toContain("Provider providerOne returned HTTP 500");
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
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["providerOne"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider providerOne returned HTTP 503");
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
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["providerOne"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider providerOne stream failed after assistant output started");
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
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["providerOne"] });

      expect(responseText).toContain("Provider providerOne returned HTTP 500");
      expect(responseText).not.toContain("User prompt");
      expect(responseText).not.toContain("private roadmap");
      expect(responseText).not.toContain("prior messages");
    });

    it("does not return raw header-like or env-like provider HTTP bodies", async () => {
      const rawBody =
        "X-Internal-Trace: trace-abc-123\nPROVIDER_ONE_BASE_URL=https://internal.example";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 502))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["providerOne"] });

      expect(responseText).toContain("Provider providerOne returned HTTP 502");
      expect(responseText).not.toContain("X-Internal-Trace");
      expect(responseText).not.toContain("trace-abc-123");
      expect(responseText).not.toContain("PROVIDER_ONE_BASE_URL");
      expect(responseText).not.toContain("internal.example");
    });

    it("does not return secret-shaped provider HTTP bodies", async () => {
      const rawBody = "provider said Authorization: Bearer raw-provider-token-12345";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => textResponse(rawBody, 500))
      );
      const { handlers } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["providerOne"] });

      expect(responseText).toContain("Provider providerOne returned HTTP 500");
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
        createOpenAIProvider("providerOne", "https://provider-one.example/v1")
      ]);

      const responseText = await callOssChat(handlers, { providerPriority: ["providerOne"] });

      expect(responseText).toContain("providerOne");
      expect(responseText).toContain("HTTP 429");
      expect(responseText).toContain("before_first_token");
      expect(responseText).toContain("retryable");
      expect(responseText).not.toContain("raw body should be omitted");
    });

    it("still falls back for retryable HTTP errors before first token", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://provider-one.example")) {
          return textResponse("raw body from first provider fallback-leak", 500);
        }
        return jsonResponse({
          choices: [{ message: { content: "fallback answer" } }]
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const { handlers, telemetry } = makeRegisteredToolsWithProviders([
        createOpenAIProvider("providerOne", "https://provider-one.example/v1"),
        createOpenAIProvider("providerTwo", "https://provider-two.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["providerOne", "providerTwo"]
      });

      expect(responseText).toContain('"providerId": "providerTwo"');
      expect(responseText).toContain("Provider providerOne returned HTTP 500");
      expect(responseText).not.toContain("fallback-leak");
      expect(JSON.stringify(telemetry.getEvents())).not.toContain("fallback-leak");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("still does not fallback after first streamed token", async () => {
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.startsWith("https://provider-two.example")) {
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
        createOpenAIProvider("providerOne", "https://provider-one.example/v1"),
        createOpenAIProvider("providerTwo", "https://provider-two.example/v1")
      ]);

      const responseText = await callOssChat(handlers, {
        providerPriority: ["providerOne", "providerTwo"],
        streaming: { enabled: true }
      });

      expect(responseText).toContain("Provider providerOne stream failed after assistant output started");
      expect(responseText).not.toContain("must not be used");
      expect(responseText).not.toContain("no-fallback-leak");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("registers inspect_model_policies", () => {
    const { handlers } = makeRegisteredTools();

    expect(handlers.has("inspect_model_policies")).toBe(true);
  });

  it("registers run_policy_doctor", () => {
    const { handlers } = makeRegisteredTools();

    expect(handlers.has("run_policy_doctor")).toBe(true);
  });

  it("lists all model policies through inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({}))!
    ) as {
      models: Array<{
        modelId: string;
        repairs: string[];
        context: { effectiveContextTokens: number };
        providerOverrides: unknown[];
        warnings: unknown[];
        valid: boolean;
      }>;
    };

    expect(body.models.map((model) => model.modelId)).toEqual([
      "kimi-k2-6",
      "deepseek-v4-pro",
      "deepseek-flash"
    ]);
    expect(body.models.every((model) => model.valid)).toBe(true);
  });

  it("filters inspect_model_policies by modelId", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({ modelId: "deepseek-v4-pro" }))!
    ) as { models: Array<{ modelId: string }> };

    expect(body.models.map((model) => model.modelId)).toEqual(["deepseek-v4-pro"]);
  });

  it("shows the DeepSeek provider override from YAML in inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      models: Array<{
        providerOverrides: Array<{
          providerId: string;
          thinking: string;
          reason: string;
        }>;
      }>;
    };

    expect(body.models[0]?.providerOverrides).toEqual([
      {
        providerId: "providerTwo",
        thinking: "disabled",
        reason: "deepseek-v4-pro on providerTwo must run with thinking disabled"
      }
    ]);
  });

  it("hides repairs when inspect_model_policies includeRepairs is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeRepairs: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("repairs");
    expect(body.models[0]).toHaveProperty("context");
  });

  it("hides context when inspect_model_policies includeContext is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeContext: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("context");
    expect(body.models[0]).toHaveProperty("repairs");
  });

  it("hides providerOverrides when inspect_model_policies includeOverrides is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeOverrides: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("providerOverrides");
    expect(body.models[0]).toHaveProperty("warnings");
  });

  it("returns a structured invalid response for unknown inspect_model_policies modelId", async () => {
    const { handlers } = makeRegisteredTools();

    const result = await handlers.get("inspect_model_policies")?.({
      modelId: "not-a-model"
    });
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string; message: string }>;
      error: { toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool inspect_model_policies input is invalid.");
    expect(body.issues[0]?.path).toBe("modelId");
    expect(body.issues[0]?.message).toContain("Unknown modelId not-a-model.");
    expect(body.error.toolName).toBe("inspect_model_policies");
    expect(body.error.modelMessage).toBe(body.modelMessage);
  });

  it("returns a structured invalid response for unknown run_policy_doctor modelId", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      modelId: "not-a-model"
    });
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string; message: string }>;
      error: { toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool run_policy_doctor input is invalid.");
    expect(body.issues[0]?.path).toBe("modelId");
    expect(body.issues[0]?.message).toContain("Unknown modelId not-a-model.");
    expect(body.error.toolName).toBe("run_policy_doctor");
    expect(body.error.modelMessage).toBe(body.modelMessage);
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("returns a structured invalid response without telemetry for invalid run_policy_doctor schema input", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeTelemetry: "yes"
    });
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string; message: string }>;
      error: { code: string; toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool run_policy_doctor input is invalid.");
    expect(body.issues[0]?.path).toBe("includeTelemetry");
    expect(body.error.code).toBe("tool_input_invalid");
    expect(body.error.toolName).toBe("run_policy_doctor");
    expect(body.error.modelMessage).toBe(body.modelMessage);
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("does not append JSONL telemetry for invalid run_policy_doctor schema input", async () => {
    const telemetryPath = tempTelemetryPath();
    const telemetry = new JsonlTelemetrySink(telemetryPath);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeProviderConfig: "no"
    });

    expect(result?.isError).toBe(true);
    expect(readFileSync(telemetryPath, "utf8")).toBe("");
  });

  it("does not append JSONL telemetry for unknown run_policy_doctor modelId", async () => {
    const telemetryPath = tempTelemetryPath();
    const telemetry = new JsonlTelemetrySink(telemetryPath);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      modelId: "not-a-model"
    });

    expect(result?.isError).toBe(true);
    expect(readFileSync(telemetryPath, "utf8")).toBe("");
  });

  it("does not record telemetry for valid run_policy_doctor input", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeTelemetry: false,
      includeProviderConfig: false
    });

    expect(result?.isError).toBeFalsy();
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("does not expose provider credentials through inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const response =
      (await handlers.get("inspect_model_policies")?.({ includeWarnings: true }))?.content[0]
        ?.text ?? "";

    expect(response).not.toContain("PROVIDER_ONE_API_KEY");
    expect(response).not.toContain("PROVIDER_TWO_API_KEY");
    expect(response).not.toContain("YOUR_KEY");
    expect(response).not.toContain("sk-");
  });

  it("returns standardized invalid responses with modelMessage", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);
    const result = await handlers.get("get_model_policy")?.({ modelId: "not-a-model" });

    expect(result?.isError).toBe(true);
    const body = parseToolResult(result!);

    expect(body).toMatchObject({
      valid: false,
      error: {
        code: "tool_input_invalid",
        toolName: "get_model_policy"
      }
    });
    expect((body as { modelMessage: string }).modelMessage).toContain(
      "Tool get_model_policy input is invalid."
    );
    expect((body as { issues: unknown[] }).issues).toHaveLength(1);
    expect(telemetry.getEvents()).toEqual([
      expect.objectContaining({
        type: "tool_input_invalid",
        toolName: "get_model_policy"
      })
    ]);
  });

  it("queries telemetry with redacted metadata only when requested", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "eval_event_recorded",
      modelId: "kimi-k2-6",
      toolName: "record_eval_event",
      metadata: {
        apiKey: "sk-secret-value",
        nested: {
          token: "token-secret",
          safe: "visible",
          disguised: "Bearer raw-secret-token"
        },
        long: "x".repeat(650)
      }
    });
    const storedMetadata = telemetry.getEvents()[0]?.metadata ?? {};
    expect(storedMetadata.apiKey).toBe("<redacted>");
    expect((storedMetadata.nested as Record<string, unknown>).token).toBe("<redacted>");
    expect((storedMetadata.nested as Record<string, unknown>).disguised).toBe("<redacted>");

    const { handlers } = makeRegisteredTools(telemetry);

    const withoutMetadata = parseToolResult(
      (await handlers.get("query_telemetry")?.({ includeMetadata: false }))!
    ) as { events: Array<Record<string, unknown>> };
    const withMetadata = parseToolResult(
      (await handlers.get("query_telemetry")?.({ includeMetadata: true }))!
    ) as { events: Array<{ metadata: Record<string, unknown> }> };

    expect(withoutMetadata.events[0]).not.toHaveProperty("metadata");
    expect(withMetadata.events[0]?.metadata.apiKey).toBe("<redacted>");
    expect((withMetadata.events[0]?.metadata.nested as Record<string, unknown>).token).toBe(
      "<redacted>"
    );
    expect((withMetadata.events[0]?.metadata.nested as Record<string, unknown>).disguised).toBe(
      "<redacted>"
    );
    expect((withMetadata.events[0]?.metadata.nested as Record<string, unknown>).safe).toBe(
      "visible"
    );
    expect(withMetadata.events[0]?.metadata.long as string).toContain("<truncated");
  });

  it("does not echo raw secrets or raw payload fields from repair_tool_input", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaName: "writeFile",
      input: {
        pathString: "src/a.ts",
        content: "password=raw-password-value\napiKey=raw-api-key-value",
        metadata: {
          apiKey: "raw-api-key-value",
          nested: {
            token: "raw-token-value"
          }
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      normalized: boolean;
      sanitizedOutputPreview: Record<string, unknown>;
      repairedInput?: unknown;
      normalizedInput?: unknown;
      data?: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.normalized).toBe(false);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("repairedInput");
    expect(body).not.toHaveProperty("normalizedInput");
    expect(body.sanitizedOutputPreview.content).toMatch(/^<omitted:content:/);
    expect(rawText).not.toContain("raw-password-value");
    expect(rawText).not.toContain("raw-api-key-value");
    expect(rawText).not.toContain("raw-token-value");
  });

  it("repairs caller-provided schema bare strings to arrays", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: "src/a.ts"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      schemaName: string;
      repairsApplied: string[];
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(true);
    expect(body.schemaName).toBe("callerPathBatch");
    expect(body.repairsApplied).toContain("bareStringToArray");
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts"]);
  });

  it("parses caller-provided JSON array strings before wrapping bare strings", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: "[\"src/a.ts\",\"src/b.ts\"]"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repairsApplied: string[];
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.repairsApplied).toContain("parseJsonArrayString");
    expect(body.repairsApplied).not.toContain("bareStringToArray");
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("unwraps caller-provided pathStringFields markdown auto-links", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "callerRead",
        schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            reason: { type: "string", optional: true }
          },
          required: ["path"]
        },
        pathStringFields: ["path"]
      },
      input: {
        path: "[src/a.ts](src/a.ts)",
        reason: "[keep-me](keep-me)"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: { path?: string; reason?: string };
    };

    expect(body.valid).toBe(true);
    expect(body.sanitizedOutputPreview.path).toBe("src/a.ts");
    expect(body.sanitizedOutputPreview.reason).toBe("[keep-me](keep-me)");
  });

  it("unwraps caller-provided pathStringArrayFields markdown auto-links inside arrays", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: ["[src/a.ts](src/a.ts)", "<src/b.ts>"]
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: { paths?: string[] };
      repairsApplied: string[];
    };

    expect(body.valid).toBe(true);
    expect(body.repairsApplied).toEqual(["markdownPathAutolinkUnwrap"]);
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not modify valid caller-provided schema input", async () => {
    const { handlers } = makeRegisteredTools();
    const input = {
      paths: ["src/a.ts"],
      label: "keep"
    };
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      repairsApplied: string[];
      notes: unknown[];
      sanitizedOutputPreview: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.repairsApplied).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.sanitizedOutputPreview).toEqual(input);
  });

  it("keeps built-in repair schemas working unchanged", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaName: "pathBatch",
      input: {
        paths: "src/a.ts"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      schemaName: string;
      repaired: boolean;
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.schemaName).toBe("pathBatch");
    expect(body.repaired).toBe(true);
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts"]);
  });

  it("returns structured issues and modelMessage for invalid caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "badDescriptor",
        schema: { type: "string" }
      },
      input: "anything"
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string }>;
      error: { toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(body.issues.some((issue) => issue.path === "schemaDescriptor.schema.type")).toBe(true);
    expect(body.error.toolName).toBe("repair_tool_input");
    expect(body.error.modelMessage).toBe(body.modelMessage);
  });

  it("rejects __proto__ fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("__proto__"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(body.issues.some((issue) => issue.message.includes("__proto__"))).toBe(true);
  });

  it("rejects prototype fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("prototype"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("prototype"))).toBe(true);
  });

  it("rejects constructor fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("constructor"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("constructor"))).toBe(true);
  });

  it("rejects dangerous keys in caller pathStringFields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "dangerousPath",
        schema: {
          type: "object",
          properties: {
            safe: { type: "string" }
          }
        },
        pathStringFields: ["__proto__"]
      },
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("__proto__"))).toBe(true);
  });

  it("rejects dangerous keys in caller pathStringArrayFields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "dangerousArrayPath",
        schema: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        pathStringArrayFields: ["constructor"]
      },
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("constructor"))).toBe(true);
  });

  it("allows normal nested safe caller descriptor fields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "safeNested",
        schema: {
          type: "object",
          properties: {
            config: {
              type: "object",
              properties: {
                value: { type: "string" }
              }
            }
          }
        }
      },
      input: {
        config: {
          value: "ok"
        }
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      sanitizedOutputPreview: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.sanitizedOutputPreview).toEqual({
      config: {
        value: "ok"
      }
    });
  });

  it("rejects oversized and deep caller descriptors safely", async () => {
    const { handlers } = makeRegisteredTools();
    const properties = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`field${index}`, { type: "string" }])
    );
    const oversized = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "tooManyFields",
        schema: {
          type: "object",
          properties
        }
      },
      input: {}
    });
    const deep = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "tooDeep",
        schema: {
          type: "object",
          properties: {
            a: {
              type: "object",
              properties: {
                b: {
                  type: "object",
                  properties: {
                    c: {
                      type: "object",
                      properties: {
                        d: {
                          type: "object",
                          properties: {
                            e: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      input: {}
    });

    const oversizedBody = parseToolResult(oversized!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };
    const deepBody = parseToolResult(deep!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };

    expect(oversized?.isError).toBe(true);
    expect(deep?.isError).toBe(true);
    expect(oversizedBody.valid).toBe(false);
    expect(deepBody.valid).toBe(false);
    expect(oversizedBody.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(deepBody.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(oversizedBody.issues.some((issue) => issue.message.includes("maximum is 50"))).toBe(
      true
    );
    expect(deepBody.issues.some((issue) => issue.message.includes("maximum is 5"))).toBe(true);
  });

  it("does not leak raw secrets or file content from caller-provided repair responses", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "callerWrite",
        schema: {
          type: "object",
          properties: {
            content: { type: "string" },
            metadata: {
              type: "object",
              properties: {
                apiKey: { type: "string" },
                fileContent: { type: "string" }
              }
            }
          }
        }
      },
      input: {
        content: "password=raw-password-value\nsuper secret file body",
        metadata: {
          apiKey: "raw-api-key-value",
          fileContent: "raw-file-content-value"
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: {
        content?: string;
        metadata?: Record<string, unknown>;
      };
    };

    expect(body.valid).toBe(true);
    expect(body.sanitizedOutputPreview.content).toMatch(/^<omitted:content:/);
    expect(body.sanitizedOutputPreview.metadata?.apiKey).toBe("<redacted>");
    expect(body.sanitizedOutputPreview.metadata?.fileContent).toMatch(/^<omitted:filecontent:/);
    expect(rawText).not.toContain("raw-password-value");
    expect(rawText).not.toContain("super secret file body");
    expect(rawText).not.toContain("raw-api-key-value");
    expect(rawText).not.toContain("raw-file-content-value");
  });

  it("does not leak raw secrets in invalid caller descriptor responses", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("constructor"),
      input: {
        content: "password=raw-invalid-descriptor-password",
        metadata: {
          apiKey: "raw-invalid-descriptor-api-key"
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(rawText).not.toContain("raw-invalid-descriptor-password");
    expect(rawText).not.toContain("raw-invalid-descriptor-api-key");
  });

  it("summarizes file content, commands, headers, and env in telemetry responses", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "eval_event_recorded",
      toolName: "record_eval_event",
      metadata: {
        fileContent: "super sensitive file content",
        command: "deploy --token raw-token-value",
        headers: {
          authorization: "Bearer raw-authorization-value",
          cookie: "sid=raw-cookie-value"
        },
        env: {
          API_KEY: "raw-env-key"
        },
        stdout: "token=raw-stdout-token",
        stderr: "password=raw-stderr-password"
      }
    });
    const storedMetadata = telemetry.getEvents()[0]?.metadata ?? {};
    expect(storedMetadata.fileContent).toMatch(/^<omitted:filecontent:/);
    expect(storedMetadata.command).toMatch(/^<omitted:command:/);
    expect(storedMetadata.headers).toMatch(/^<omitted:headers:/);
    expect(storedMetadata.env).toMatch(/^<omitted:env:/);

    const { handlers } = makeRegisteredTools(telemetry);

    const rawText =
      (await handlers.get("query_telemetry")?.({ includeMetadata: true }))?.content[0]?.text ??
      "";
    const result = JSON.parse(rawText) as {
      events: Array<{ metadata: Record<string, unknown> }>;
    };
    const metadata = result.events[0]?.metadata ?? {};

    expect(metadata.fileContent).toMatch(/^<omitted:filecontent:/);
    expect(metadata.command).toMatch(/^<omitted:command:/);
    expect(metadata.headers).toMatch(/^<omitted:headers:/);
    expect(metadata.env).toMatch(/^<omitted:env:/);
    expect(metadata.stdout).toMatch(/^<omitted:stdout:/);
    expect(metadata.stderr).toMatch(/^<omitted:stderr:/);
    expect(rawText).not.toContain("raw-token-value");
    expect(rawText).not.toContain("raw-authorization-value");
    expect(rawText).not.toContain("raw-cookie-value");
    expect(rawText).not.toContain("raw-env-key");
    expect(rawText).not.toContain("raw-stdout-token");
    expect(rawText).not.toContain("raw-stderr-password");
  });

  it("stores sessionId only as a hash and still filters by raw sessionId", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const rawSessionId = "user-123-secret-session";
    telemetry.record({
      type: "eval_event_recorded",
      sessionId: rawSessionId,
      modelId: "kimi-k2-6",
      metadata: {
        note: "safe",
        nested: {
          sessionId: rawSessionId
        }
      }
    });
    telemetry.record({
      type: "eval_event_recorded",
      sessionId: "other-session",
      modelId: "deepseek-flash"
    });

    const storedEvent = telemetry.getEvents()[0];
    const storedText = JSON.stringify(telemetry.getEvents());

    expect(storedEvent).not.toHaveProperty("sessionId");
    expect(storedEvent?.sessionIdHash).toBe(hashSessionId(rawSessionId));
    expect(storedText).not.toContain(rawSessionId);

    const { handlers } = makeRegisteredTools(telemetry);
    const response =
      (await handlers.get("query_telemetry")?.({
        sessionId: rawSessionId,
        includeMetadata: true
      }))?.content[0]?.text ?? "";
    const body = JSON.parse(response) as {
      total: number;
      returned: number;
      events: Array<{
        sessionId?: string;
        sessionIdHash?: string;
        metadata?: Record<string, unknown>;
      }>;
    };

    expect(body.total).toBe(1);
    expect(body.returned).toBe(1);
    expect(body.events[0]?.sessionId).toBeUndefined();
    expect(body.events[0]?.sessionIdHash).toBe(hashSessionId(rawSessionId));
    expect(body.events[0]?.metadata?.nested).toMatchObject({
      sessionId: "<redacted>"
    });
    expect(response).not.toContain(rawSessionId);
  });

  it("does not trust caller-provided sessionIdHash without sessionId", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const rawSessionIdHash = "raw-secret-session";

    telemetry.record({
      type: "eval_event_recorded",
      sessionIdHash: rawSessionIdHash,
      modelId: "kimi-k2-6"
    });

    const storedText = JSON.stringify(telemetry.getEvents());
    const storedEvent = telemetry.getEvents()[0];

    expect(storedEvent).not.toHaveProperty("sessionId");
    expect(storedEvent).not.toHaveProperty("sessionIdHash");
    expect(storedText).not.toContain(rawSessionIdHash);

    const { handlers } = makeRegisteredTools(telemetry);
    const response =
      (await handlers.get("query_telemetry")?.({ includeMetadata: true }))?.content[0]?.text ??
      "";

    expect(response).not.toContain(rawSessionIdHash);
  });

  it("overwrites malicious sessionIdHash with the internally computed session hash", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const rawSessionId = "user-456-secret-session";
    const maliciousSessionIdHash = "raw-secret-session";

    telemetry.record({
      type: "eval_event_recorded",
      sessionId: rawSessionId,
      sessionIdHash: maliciousSessionIdHash,
      modelId: "kimi-k2-6"
    });

    const storedEvent = telemetry.getEvents()[0];
    const storedText = JSON.stringify(telemetry.getEvents());

    expect(storedEvent).not.toHaveProperty("sessionId");
    expect(storedEvent?.sessionIdHash).toBe(hashSessionId(rawSessionId));
    expect(storedEvent?.sessionIdHash).not.toBe(maliciousSessionIdHash);
    expect(storedText).not.toContain(rawSessionId);
    expect(storedText).not.toContain(maliciousSessionIdHash);

    const { handlers } = makeRegisteredTools(telemetry);
    const response =
      (await handlers.get("query_telemetry")?.({ sessionId: rawSessionId }))?.content[0]?.text ??
      "";
    const body = JSON.parse(response) as { total: number; events: Array<{ sessionIdHash?: string }> };

    expect(body.total).toBe(1);
    expect(body.events[0]?.sessionIdHash).toBe(hashSessionId(rawSessionId));
    expect(response).not.toContain(rawSessionId);
    expect(response).not.toContain(maliciousSessionIdHash);
  });

  it("keeps session hashing deterministic with and without explicit salt", () => {
    const rawSessionId = "user-789-secret-session";
    const originalSalt = process.env.OSS_HARNESS_TELEMETRY_SALT;
    try {
      const firstUnsalted = hashSessionId(rawSessionId);
      process.env.OSS_HARNESS_TELEMETRY_SALT = "changed-after-module-load";
      const secondUnsalted = hashSessionId(rawSessionId);
      const firstSalted = hashSessionIdWithSalt(rawSessionId, "deployment-salt");
      const secondSalted = hashSessionIdWithSalt(rawSessionId, "deployment-salt");

      expect(secondUnsalted).toBe(firstUnsalted);
      expect(firstSalted).toBe(secondSalted);
      expect(firstSalted).not.toBe(hashSessionIdWithSalt(rawSessionId, "other-salt"));
      expect(firstSalted).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      if (originalSalt === undefined) {
        delete process.env.OSS_HARNESS_TELEMETRY_SALT;
      } else {
        process.env.OSS_HARNESS_TELEMETRY_SALT = originalSalt;
      }
    }
  });

  it("suggests repair-policy order from MCP telemetry without editing policies", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      modelId: "deepseek-v4-pro",
      metadata: {
        repairs: ["bareStringToArray", "bareStringToArray", "parseJsonArrayString"]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      suggestions: Array<{
        modelId: string;
        suggestedRepairOrder: string[];
        currentPolicyOrder: string[];
      }>;
      policySuggestions: Array<{ modelId: string; kind: string }>;
      note: string;
    };

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.modelId).toBe("deepseek-v4-pro");
    expect(result.suggestions[0]?.suggestedRepairOrder[0]).toBe("bareStringToArray");
    expect(result.suggestions[0]?.currentPolicyOrder).toContain("parseJsonArrayString");
    expect(result.policySuggestions[0]).toMatchObject({
      modelId: "deepseek-v4-pro",
      kind: "repair_order"
    });
    expect(result.note).toBe("No YAML policies were modified.");
  });

  it("returns an explicit insufficient_data row for requested models with zero repair telemetry", async () => {
    const { handlers } = makeRegisteredTools();

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-flash" }))!
    ) as {
      suggestions: unknown[];
      policySuggestions: Array<{
        modelId: string;
        kind: string;
        status: string;
        confidence: string;
        window: { type: string; limit: number; eventCount: number };
        currentRepairs?: string[];
        suggestedRepairs: string[];
        warnings: Array<{ code: string; message: string }>;
        reason: string;
        yamlPatchPreview: string | null;
      }>;
    };
    const suggestion = result.policySuggestions[0];

    expect(result.suggestions).toEqual([]);
    expect(result.policySuggestions).toHaveLength(1);
    expect(suggestion).toMatchObject({
      modelId: "deepseek-flash",
      kind: "repair_order",
      status: "insufficient_data",
      confidence: "low",
      window: {
        type: "latest",
        limit: 200,
        eventCount: 0
      },
      suggestedRepairs: [],
      yamlPatchPreview: null
    });
    expect(suggestion?.currentRepairs).toEqual([
      "markdownPathAutolinkUnwrap",
      "parseJsonArrayString",
      "bareStringToArray"
    ]);
    expect(suggestion?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "zero_repaired_telemetry_events",
          message:
            "No repaired telemetry events were found for this model in the bounded latest window."
        }),
        expect.objectContaining({ code: "bounded_latest_window" }),
        expect.objectContaining({ code: "telemetry_sink_configured" })
      ])
    );
    expect(suggestion?.reason).toContain("no repair-order change is suggested");
  });

  it("warns instead of crashing when a zero-event model policy is missing", () => {
    const suggestions = createReviewableRepairPolicySuggestions([], {
      modelId: "missing-policy-model",
      limit: 200,
      currentRepairsForModel: () => undefined
    });

    expect(suggestions).toMatchObject([
      {
        modelId: "missing-policy-model",
        status: "insufficient_data",
        confidence: "low",
        window: {
          type: "latest",
          limit: 200,
          eventCount: 0
        },
        suggestedRepairs: [],
        yamlPatchPreview: null
      }
    ]);
    expect(suggestions[0]?.currentRepairs).toBeUndefined();
    expect(suggestions[0]?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "zero_repaired_telemetry_events" }),
        expect.objectContaining({ code: "current_policy_unavailable" }),
        expect.objectContaining({ code: "model_policy_not_found" })
      ])
    );
  });

  it("does not emit zero-event policy suggestions for every model when modelId is omitted", async () => {
    const { handlers } = makeRegisteredTools();

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      suggestions: unknown[];
      policySuggestions: unknown[];
    };

    expect(result.suggestions).toEqual([]);
    expect(result.policySuggestions).toEqual([]);
  });

  it("keeps zero-event suggestion output sanitized", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "raw-zero-suggest-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray"],
        apiKey: "raw-zero-api-key",
        fileContent: "raw-zero-file-content",
        command: "deploy --token raw-zero-command-token",
        headers: {
          authorization: "Bearer raw-zero-authorization"
        },
        env: {
          API_KEY: "raw-zero-env-key"
        },
        stdout: "token=raw-zero-stdout-token",
        stderr: "password=raw-zero-stderr-password",
        messages: [{ role: "user", content: "raw zero prompt content" }]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-flash" }))?.content[0]
        ?.text ?? "";

    expect(response).toContain("insufficient_data");
    expect(response).not.toContain("raw-zero-suggest-session");
    expect(response).not.toContain("raw-zero-api-key");
    expect(response).not.toContain("raw-zero-file-content");
    expect(response).not.toContain("raw-zero-command-token");
    expect(response).not.toContain("raw-zero-authorization");
    expect(response).not.toContain("raw-zero-env-key");
    expect(response).not.toContain("raw-zero-stdout-token");
    expect(response).not.toContain("raw-zero-stderr-password");
    expect(response).not.toContain("raw zero prompt content");
  });

  it("builds reviewable repair policy suggestions grouped by model and ordered by frequency", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["parseJsonArrayString"], 3);
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray"], 1);
    recordRepairEvents(telemetry, "deepseek-v4-pro", ["stripNullOptional"], 2);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{
        modelId: string;
        confidence: string;
        currentRepairs?: string[];
        suggestedRepairs: string[];
        window: { eventCount: number; limit: number; type: string };
        yamlPatchPreview: string;
      }>;
    };
    const kimi = result.policySuggestions.find((suggestion) => suggestion.modelId === "kimi-k2-6");
    const deepseek = result.policySuggestions.find(
      (suggestion) => suggestion.modelId === "deepseek-v4-pro"
    );

    expect(result.policySuggestions.map((suggestion) => suggestion.modelId).sort()).toEqual([
      "deepseek-v4-pro",
      "kimi-k2-6"
    ]);
    expect(kimi?.suggestedRepairs.slice(0, 2)).toEqual([
      "parseJsonArrayString",
      "bareStringToArray"
    ]);
    expect(kimi?.currentRepairs).toEqual([
      "emptyObjectToArray",
      "parseJsonArrayString",
      "bareStringToArray",
      "stripNullOptional"
    ]);
    expect(kimi?.window).toEqual({ type: "latest", limit: 200, eventCount: 4 });
    expect(kimi?.confidence).toBe("low");
    expect(kimi?.yamlPatchPreview).toContain("repairs:");
    expect(deepseek?.suggestedRepairs[0]).toBe("stripNullOptional");
  });

  it("marks repair policy suggestions as already_aligned when they match current policy", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(
      telemetry,
      "deepseek-v4-pro",
      [
        "parseJsonArrayString",
        "bareStringToArray",
        "stripNullOptional",
        "markdownPathAutolinkUnwrap"
      ],
      1
    );
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      policySuggestions: Array<{
        status: string;
        warnings: Array<{ code: string }>;
        yamlPatchPreview: string;
      }>;
    };

    expect(result.policySuggestions[0]?.status).toBe("already_aligned");
    expect(result.policySuggestions[0]?.warnings).toContainEqual({
      code: "suggested_order_unchanged",
      message: "Suggested repair order already matches the current model policy."
    });
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("No YAML change is suggested");
  });

  it("assigns low, medium, and high confidence by repaired event count", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "low-confidence-model", ["bareStringToArray"], 9);
    recordRepairEvents(telemetry, "medium-confidence-model", ["bareStringToArray"], 10);
    recordRepairEvents(telemetry, "high-confidence-model", ["bareStringToArray"], 50);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{ modelId: string; confidence: string }>;
    };

    expect(confidenceFor(result.policySuggestions, "low-confidence-model")).toBe("low");
    expect(confidenceFor(result.policySuggestions, "medium-confidence-model")).toBe("medium");
    expect(confidenceFor(result.policySuggestions, "high-confidence-model")).toBe("high");
  });

  it("warns on unknown repair names and excludes them from yamlPatchPreview", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray", "unknownRepairName"], 1);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))!
    ) as {
      policySuggestions: Array<{
        warnings: Array<{ code: string }>;
        yamlPatchPreview: string;
      }>;
    };

    expect(result.policySuggestions[0]?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown_repair_names"
        })
      ])
    );
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("bareStringToArray");
    expect(result.policySuggestions[0]?.yamlPatchPreview).not.toContain("unknownRepairName");
  });

  it("warns when a model policy is missing without crashing", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "missing-policy-model", ["bareStringToArray"], 1);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{
        modelId: string;
        status: string;
        currentRepairs?: string[];
        warnings: Array<{ code: string }>;
      }>;
    };
    const missing = result.policySuggestions.find(
      (suggestion) => suggestion.modelId === "missing-policy-model"
    );

    expect(missing?.status).toBe("policy_not_found");
    expect(missing?.currentRepairs).toBeUndefined();
    expect(missing?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "current_policy_unavailable" }),
        expect.objectContaining({ code: "model_policy_not_found" })
      ])
    );
  });

  it("returns yamlPatchPreview without writing policy files", async () => {
    const policyPath = "src/policies/kimi-k2-6.yaml";
    const before = readFileSync(policyPath, "utf8");
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray"], 2);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))!
    ) as { policySuggestions: Array<{ yamlPatchPreview: string }> };
    const after = readFileSync(policyPath, "utf8");

    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain(
      "Suggestion only; review manually"
    );
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("bareStringToArray");
    expect(after).toBe(before);
  });

  it("does not leak raw sensitive telemetry into repair policy suggestions", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "raw-suggest-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray", "token=raw-repair-token"],
        apiKey: "raw-api-key-value",
        fileContent: "raw-file-content-value",
        command: "deploy --token raw-command-token",
        headers: {
          authorization: "Bearer raw-authorization-value"
        },
        env: {
          API_KEY: "raw-env-key"
        },
        stdout: "token=raw-stdout-token",
        stderr: "password=raw-stderr-password",
        messages: [{ role: "user", content: "raw prompt content" }]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))?.content[0]
        ?.text ?? "";

    expect(response).toContain("policySuggestions");
    expect(response).not.toContain("raw-suggest-session");
    expect(response).not.toContain("raw-repair-token");
    expect(response).not.toContain("raw-api-key-value");
    expect(response).not.toContain("raw-file-content-value");
    expect(response).not.toContain("raw-command-token");
    expect(response).not.toContain("raw-authorization-value");
    expect(response).not.toContain("raw-env-key");
    expect(response).not.toContain("raw-stdout-token");
    expect(response).not.toContain("raw-stderr-password");
    expect(response).not.toContain("raw prompt content");
  });

  it("returns zero-count harness stats for empty telemetry", async () => {
    const { handlers } = makeRegisteredTools();

    const result = parseToolResult((await handlers.get("get_harness_stats")?.({}))!) as {
      window: { type: string; limit: number };
      totals: { events: number; models: number; providers: number };
      toolInputs: {
        invalid: number;
        repaired: number;
        normalized: number;
        repairSuccessRate: number;
      };
      repairs: { byModel: Record<string, number>; byRepair: Record<string, number> };
      routing: { fallbacks: number };
      streaming: { success: number };
      cache: { likelyWarm: number; likelyCold: number; warmRate: number };
      context: { compactions: number };
      caveats: string[];
    };

    expect(result.window).toEqual({ type: "latest", limit: 200 });
    expect(result.totals).toEqual({ events: 0, models: 0, providers: 0 });
    expect(result.toolInputs).toEqual({
      invalid: 0,
      repaired: 0,
      normalized: 0,
      repairSuccessRate: 0
    });
    expect(result.repairs.byModel).toEqual({});
    expect(result.repairs.byRepair).toEqual({});
    expect(result.routing.fallbacks).toBe(0);
    expect(result.streaming.success).toBe(0);
    expect(result.cache).toEqual({ likelyWarm: 0, likelyCold: 0, warmRate: 0 });
    expect(result.context.compactions).toBe(0);
    expect(result.caveats).toContain(
      "telemetry may be in-memory or local JSONL depending on configuration"
    );
    expect(result.caveats).toContain("stats are based on the bounded latest telemetry window");
  });

  it("computes harness stats from sanitized telemetry events", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_invalid",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input"
    });
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray", "parseJsonArrayString"]
      }
    });
    telemetry.record({
      type: "tool_input_normalized",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input"
    });
    telemetry.record({
      type: "provider_fallback",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      providerId: "providerOne",
      metadata: {
        fromProvider: "providerOne",
        toProvider: "providerTwo",
        fallbackPhase: "before_first_token"
      }
    });
    telemetry.record({
      type: "cache_likely_cold",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      providerId: "providerOne"
    });
    telemetry.record({
      type: "cache_likely_warm",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      providerId: "providerOne"
    });
    telemetry.record({
      type: "context_compacted",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      metadata: {
        strategy: "aggressive_drop"
      }
    });
    telemetry.record({
      type: "eval_event_recorded",
      sessionId: "stats-session",
      modelId: "deepseek-v4-pro",
      metadata: {
        streamingStatus: "success"
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("get_harness_stats")?.({}))!) as {
      totals: { events: number; models: number; providers: number };
      toolInputs: {
        invalid: number;
        repaired: number;
        normalized: number;
        repairSuccessRate: number;
      };
      repairs: {
        byModel: Record<string, number>;
        byRepair: Record<string, number>;
        byTool: Record<string, number>;
      };
      routing: {
        fallbacks: number;
        byProvider: Record<string, number>;
        byPhase: Record<string, number>;
      };
      streaming: {
        success: number;
        failuresBeforeFirstToken: number;
      };
      cache: { likelyWarm: number; likelyCold: number; warmRate: number };
      context: { compactions: number; byMode: Record<string, number> };
    };

    expect(result.totals).toEqual({ events: 8, models: 1, providers: 1 });
    expect(result.toolInputs).toEqual({
      invalid: 1,
      repaired: 1,
      normalized: 1,
      repairSuccessRate: 1
    });
    expect(result.repairs.byModel["deepseek-v4-pro"]).toBe(1);
    expect(result.repairs.byRepair.bareStringToArray).toBe(1);
    expect(result.repairs.byRepair.parseJsonArrayString).toBe(1);
    expect(result.repairs.byTool.repair_tool_input).toBe(1);
    expect(result.routing.fallbacks).toBe(1);
    expect(result.routing.byProvider.providerOne).toBe(1);
    expect(result.routing.byPhase.beforeFirstToken).toBe(1);
    expect(result.streaming.success).toBe(1);
    expect(result.streaming.failuresBeforeFirstToken).toBe(1);
    expect(result.cache).toEqual({ likelyWarm: 1, likelyCold: 1, warmRate: 0.5 });
    expect(result.context.compactions).toBe(1);
    expect(result.context.byMode.aggressive_drop).toBe(1);
  });

  it("filters harness stats by modelId", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_invalid",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input"
    });
    telemetry.record({
      type: "tool_input_invalid",
      modelId: "deepseek-flash",
      toolName: "repair_tool_input"
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("get_harness_stats")?.({ modelId: "kimi-k2-6" }))!
    ) as { totals: { events: number; models: number }; toolInputs: { invalid: number } };

    expect(result.totals).toEqual({ events: 1, models: 1, providers: 0 });
    expect(result.toolInputs.invalid).toBe(1);
  });

  it("filters harness stats by raw sessionId without returning the raw session", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const rawSessionId = "stats-secret-session";
    telemetry.record({
      type: "tool_input_invalid",
      sessionId: rawSessionId,
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input"
    });
    telemetry.record({
      type: "tool_input_invalid",
      sessionId: "other-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input"
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("get_harness_stats")?.({ sessionId: rawSessionId }))?.content[0]?.text ??
      "";
    const result = JSON.parse(response) as {
      totals: { events: number };
      toolInputs: { invalid: number };
    };

    expect(result.totals.events).toBe(1);
    expect(result.toolInputs.invalid).toBe(1);
    expect(response).not.toContain(rawSessionId);
    expect(response).not.toContain(hashSessionId(rawSessionId));
    expect(response).not.toContain("other-session");
  });

  it("does not expose secrets or risky metadata in harness stats output", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "stats-secret-session",
      modelId: "deepseek-v4-pro",
      toolName: "raw-token-tool",
      metadata: {
        repairs: ["bareStringToArray", "token=raw-repair-token"],
        apiKey: "raw-api-key-value",
        command: "deploy --token raw-command-token",
        headers: {
          authorization: "Bearer raw-authorization-value"
        },
        messages: [{ role: "user", content: "raw prompt content" }]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("get_harness_stats")?.({ sessionId: "stats-secret-session" }))?.content[0]
        ?.text ?? "";
    const result = JSON.parse(response) as {
      repairs: { byRepair: Record<string, number>; byTool: Record<string, number> };
    };

    expect(result.repairs.byRepair.bareStringToArray).toBe(1);
    expect(result.repairs.byRepair["<other>"]).toBe(1);
    expect(result.repairs.byTool["<other>"]).toBe(1);
    expect(response).not.toContain("raw-repair-token");
    expect(response).not.toContain("raw-api-key-value");
    expect(response).not.toContain("raw-command-token");
    expect(response).not.toContain("raw-authorization-value");
    expect(response).not.toContain("raw prompt content");
    expect(response).not.toContain("stats-secret-session");
  });

  it("hides provider counts and provider breakdowns when includeProviders is false", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "provider_fallback",
      modelId: "deepseek-v4-pro",
      providerId: "providerOne",
      metadata: {
        fromProvider: "providerOne",
        toProvider: "providerTwo",
        fallbackPhase: "before_first_token"
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("get_harness_stats")?.({ includeProviders: false }))?.content[0]?.text ??
      "";
    const result = JSON.parse(response) as {
      totals: { events: number; providers: number };
      routing: {
        fallbacks: number;
        byProvider: Record<string, number>;
        byPhase: Record<string, number>;
      };
    };

    expect(result.totals).toEqual({ events: 1, models: 1, providers: 0 });
    expect(result.routing.fallbacks).toBe(1);
    expect(result.routing.byProvider).toEqual({});
    expect(result.routing.byPhase.beforeFirstToken).toBe(1);
    expect(response).not.toContain("providerOne");
    expect(response).not.toContain("providerTwo");
  });

  it("filters harness stats by eventType and leaves partial repair rates explicit", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_invalid",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input"
    });
    telemetry.record({
      type: "tool_input_repaired",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray"]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("get_harness_stats")?.({ eventType: "tool_input_repaired" }))!
    ) as {
      totals: { events: number };
      toolInputs: { invalid: number; repaired: number; repairSuccessRate: number };
      repairs: { byRepair: Record<string, number> };
    };

    expect(result.totals.events).toBe(1);
    expect(result.toolInputs).toEqual({
      invalid: 0,
      repaired: 1,
      normalized: 0,
      repairSuccessRate: 0
    });
    expect(result.repairs.byRepair.bareStringToArray).toBe(1);
  });

  it("counts streaming empty, malformed, incomplete, and after-token failure classifications", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "eval_event_recorded",
      modelId: "kimi-k2-6",
      metadata: {
        streamingStatus: "empty"
      }
    });
    telemetry.record({
      type: "eval_event_recorded",
      modelId: "kimi-k2-6",
      metadata: {
        streamingStatus: "malformed"
      }
    });
    telemetry.record({
      type: "eval_event_recorded",
      modelId: "kimi-k2-6",
      metadata: {
        streamingStatus: "incomplete"
      }
    });
    telemetry.record({
      type: "eval_event_recorded",
      modelId: "kimi-k2-6",
      metadata: {
        streamingFailure: true,
        fallbackPhase: "after_first_token"
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("get_harness_stats")?.({}))!) as {
      streaming: {
        empty: number;
        malformed: number;
        incomplete: number;
        failuresAfterFirstToken: number;
        failuresBeforeFirstToken: number;
      };
    };

    expect(result.streaming.empty).toBe(1);
    expect(result.streaming.malformed).toBe(1);
    expect(result.streaming.incomplete).toBe(1);
    expect(result.streaming.failuresAfterFirstToken).toBe(1);
    expect(result.streaming.failuresBeforeFirstToken).toBe(0);
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

function confidenceFor(
  suggestions: Array<{ modelId: string; confidence: string }>,
  modelId: string
): string | undefined {
  return suggestions.find((suggestion) => suggestion.modelId === modelId)?.confidence;
}

function tempTelemetryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "oss-harness-tools-"));
  tempDirs.push(dir);
  return join(dir, "telemetry.jsonl");
}

const testProviderCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

function testProviderConfig(id: ProviderId): ProviderRuntimeConfig {
  return {
    id,
    stickySession: {
      header: "X-Session-Id",
      strategy: "raw"
    }
  };
}

function createOpenAIProvider(id: ProviderId, baseUrl: string): OpenAICompatibleProviderAdapter {
  return new OpenAICompatibleProviderAdapter({
    id,
    baseUrl,
    providerConfig: testProviderConfig(id),
    capabilities: testProviderCapabilities,
    modelSlugs: {
      "kimi-k2-6": `${id}-kimi`
    }
  });
}

function makeRegisteredToolsWithProviders(providers: ProviderAdapter[]) {
  const telemetry = new InMemoryTelemetrySink();
  const registered = makeRegisteredTools(telemetry, new ChatRouter(providers, telemetry));
  return { ...registered, telemetry };
}

async function callOssChat(
  handlers: Map<string, ToolHandler>,
  overrides: Record<string, unknown>
): Promise<string> {
  const result = await handlers.get("oss_chat")?.({
    modelId: "kimi-k2-6",
    sessionId: "provider-error-session",
    messages: [{ role: "user", content: "hello" }],
    ...overrides
  });

  return result?.content[0]?.text ?? "";
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" }
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
