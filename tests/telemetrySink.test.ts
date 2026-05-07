import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse
} from "../src/providers/types.js";
import { ChatRouter } from "../src/router/chatRouter.js";
import { hashSessionId } from "../src/security/sessionHash.js";
import { createTelemetrySinkFromEnv } from "../src/telemetry/config.js";
import { JsonlTelemetrySink } from "../src/telemetry/jsonl.js";
import { MemoryTelemetrySink } from "../src/telemetry/memory.js";
import { queryTelemetry } from "../src/telemetry/query.js";
import { createRepairTelemetryReport } from "../src/telemetry/repairReport.js";
import { getHarnessStats } from "../src/telemetry/stats.js";
import { registerTools } from "../src/tools/index.js";
import type { CapabilityFlags, CanonicalModelId, ProviderId } from "../src/types.js";

type ToolHandler = (input: unknown) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const tempDirs: string[] = [];
const allCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("telemetry sinks", () => {
  it("uses the memory sink by default", () => {
    const sink = createTelemetrySinkFromEnv({});

    expect(sink).toBeInstanceOf(MemoryTelemetrySink);
  });

  it("creates a JSONL sink from telemetry environment options", () => {
    const filePath = tempTelemetryPath();
    const sink = createTelemetrySinkFromEnv({
      OSS_HARNESS_TELEMETRY_SINK: "jsonl",
      OSS_HARNESS_TELEMETRY_JSONL_PATH: filePath
    });

    expect(sink).toBeInstanceOf(JsonlTelemetrySink);
    expect(existsSync(filePath)).toBe(true);
  });

  it("writes sanitized JSONL events", () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);

    sink.record({
      type: "eval_event_recorded",
      sessionId: "raw-jsonl-session",
      modelId: "kimi-k2-6",
      metadata: {
        apiKey: "sk-jsonl-secret",
        safe: "visible"
      }
    });

    const rawText = readFileSync(filePath, "utf8");
    const lines = rawText.trim().split(/\r?\n/);
    const event = JSON.parse(lines[0] ?? "{}") as {
      sessionId?: string;
      sessionIdHash?: string;
      metadata?: Record<string, unknown>;
    };

    expect(lines).toHaveLength(1);
    expect(event.sessionId).toBeUndefined();
    expect(event.sessionIdHash).toBe(hashSessionId("raw-jsonl-session"));
    expect(event.metadata?.apiKey).toBe("<redacted>");
    expect(event.metadata?.safe).toBe("visible");
  });

  it("queries JSONL events through the shared telemetry query path", () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);
    sink.record({
      type: "tool_input_repaired",
      sessionId: "jsonl-query-session",
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray"]
      }
    });
    sink.record({
      type: "tool_input_repaired",
      sessionId: "other-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["parseJsonArrayString"]
      }
    });

    const queryResult = queryTelemetry(sink, {
      sessionId: "jsonl-query-session",
      includeMetadata: true,
      limit: 200
    });
    const stats = getHarnessStats(sink, {
      sessionId: "jsonl-query-session"
    });
    const report = createRepairTelemetryReport(
      queryTelemetry(sink, {
        type: "tool_input_repaired",
        modelId: "deepseek-v4-pro",
        includeMetadata: true,
        limit: 200
      }).events
    );

    expect(queryResult.total).toBe(1);
    expect(queryResult.events[0]?.modelId).toBe("deepseek-v4-pro");
    expect(stats.totals.events).toBe(1);
    expect(stats.repairs.byRepair.bareStringToArray).toBe(1);
    expect(report.models["deepseek-v4-pro"]?.repairCounts.bareStringToArray).toBe(1);
  });

  it("records per-attempt capability negotiation through the JSONL sink", async () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);
    const providerOne = new JsonlFakeProvider("providerOne", {
      zeroDataRetention: false,
      disallowPromptTraining: true,
      thinking: true
    });
    const router = new ChatRouter([providerOne], sink);

    const result = await router.route({
      modelId: "kimi-k2-6",
      sessionId: "jsonl-capability-session",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerOne"],
      capabilities: {
        zeroDataRetention: true,
        disallowPromptTraining: true
      }
    });
    const negotiated = queryTelemetry(sink, {
      type: "capability_negotiated",
      providerId: "providerOne",
      includeMetadata: true,
      limit: 10
    });
    const dropped = queryTelemetry(sink, {
      type: "capability_dropped",
      providerId: "providerOne",
      includeMetadata: true,
      limit: 10
    });

    expect(result.capabilities).toEqual({
      disallowPromptTraining: true
    });
    expect(negotiated.total).toBe(1);
    expect(negotiated.events[0]?.metadata).toMatchObject({
      attemptIndex: 0,
      capabilities: {
        disallowPromptTraining: true
      },
      droppedCapabilities: ["zeroDataRetention"]
    });
    expect(dropped.events[0]).toMatchObject({
      capability: "zeroDataRetention",
      providerId: "providerOne",
      metadata: {
        reason: "unsupported_by_provider",
        attemptIndex: 0
      }
    });
  });

  it("records thinking_overridden telemetry through the JSONL sink", async () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);
    const providerTwo = new JsonlFakeProvider("providerTwo", allCapabilities);
    const router = new ChatRouter([providerTwo], sink);

    const result = await router.route({
      modelId: "deepseek-v4-pro",
      sessionId: "jsonl-thinking-session",
      messages: [{ role: "user", content: "hello" }],
      providerPriority: ["providerTwo"],
      capabilities: {
        thinking: true
      }
    });
    const overridden = queryTelemetry(sink, {
      type: "thinking_overridden",
      providerId: "providerTwo",
      includeMetadata: true,
      limit: 10
    });

    expect(result.capabilities.thinking).toBeUndefined();
    expect(overridden.total).toBe(1);
    expect(overridden.events[0]).toMatchObject({
      type: "thinking_overridden",
      modelId: "deepseek-v4-pro",
      providerId: "providerTwo",
      capability: "thinking",
      metadata: {
        reason: "deepseek-v4-pro on providerTwo must run with thinking disabled",
        source: "model_policy",
        override: "thinking_disabled",
        attemptIndex: 0
      }
    });
    expect(readFileSync(filePath, "utf8")).toContain("thinking_overridden");
  });

  it("serves query, stats, and repair suggestion MCP tools from JSONL telemetry", async () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);
    sink.record({
      type: "tool_input_repaired",
      sessionId: "jsonl-tool-session",
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray"]
      }
    });
    const handlers = registerTelemetryTools(sink);

    const queryResult = parseToolResult(
      (await handlers.get("query_telemetry")?.({
        sessionId: "jsonl-tool-session",
        includeMetadata: true
      }))!
    ) as { total: number; events: Array<{ modelId?: string }> };
    const statsResult = parseToolResult(
      (await handlers.get("get_harness_stats")?.({
        sessionId: "jsonl-tool-session"
      }))!
    ) as { totals: { events: number }; repairs: { byRepair: Record<string, number> } };
    const suggestionResult = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({
        modelId: "deepseek-v4-pro"
      }))!
    ) as {
      suggestions: Array<{ modelId: string; suggestedRepairOrder: string[] }>;
      policySuggestions: Array<{
        modelId: string;
        suggestedRepairs: string[];
        yamlPatchPreview: string;
      }>;
    };

    expect(queryResult.total).toBe(1);
    expect(queryResult.events[0]?.modelId).toBe("deepseek-v4-pro");
    expect(statsResult.totals.events).toBe(1);
    expect(statsResult.repairs.byRepair.bareStringToArray).toBe(1);
    expect(suggestionResult.suggestions[0]?.modelId).toBe("deepseek-v4-pro");
    expect(suggestionResult.suggestions[0]?.suggestedRepairOrder[0]).toBe("bareStringToArray");
    expect(suggestionResult.policySuggestions[0]?.modelId).toBe("deepseek-v4-pro");
    expect(suggestionResult.policySuggestions[0]?.suggestedRepairs[0]).toBe("bareStringToArray");
    expect(suggestionResult.policySuggestions[0]?.yamlPatchPreview).toContain("Suggestion only");
  });

  it("does not write raw sessionId values to disk", () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);
    const rawSessionId = "raw-jsonl-session-secret";

    sink.record({
      type: "eval_event_recorded",
      sessionId: rawSessionId,
      modelId: "kimi-k2-6"
    });

    const rawText = readFileSync(filePath, "utf8");
    expect(rawText).not.toContain(rawSessionId);
    expect(rawText).toContain(hashSessionId(rawSessionId));
  });

  it("does not write secrets or risky metadata to disk", () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);

    sink.record({
      type: "eval_event_recorded",
      metadata: {
        apiKey: "raw-jsonl-api-key",
        command: "deploy --token raw-jsonl-command-token",
        headers: {
          authorization: "Bearer raw-jsonl-authorization"
        },
        messages: [{ role: "user", content: "raw prompt text" }],
        stdout: "password=raw-jsonl-stdout-password"
      }
    });

    const rawText = readFileSync(filePath, "utf8");
    expect(rawText).not.toContain("raw-jsonl-api-key");
    expect(rawText).not.toContain("raw-jsonl-command-token");
    expect(rawText).not.toContain("raw-jsonl-authorization");
    expect(rawText).not.toContain("raw prompt text");
    expect(rawText).not.toContain("raw-jsonl-stdout-password");
    expect(rawText).toContain("<redacted>");
    expect(rawText).toContain("<omitted:command:");
    expect(rawText).toContain("<omitted:headers:");
    expect(rawText).toContain("<omitted:messages:");
    expect(rawText).toContain("<omitted:stdout:");
  });

  it("returns safe empty results for empty or missing JSONL files", () => {
    const filePath = tempTelemetryPath();
    const sink = new JsonlTelemetrySink(filePath);

    expect(existsSync(filePath)).toBe(true);
    expect(queryTelemetry(sink, { includeMetadata: true })).toEqual({
      total: 0,
      returned: 0,
      events: []
    });

    rmSync(filePath, { force: true });
    expect(queryTelemetry(sink, { includeMetadata: true })).toEqual({
      total: 0,
      returned: 0,
      events: []
    });
  });

  it("skips malformed JSONL lines safely", () => {
    const filePath = tempTelemetryPath();
    writeFileSync(
      filePath,
      [
        "{not-json",
        JSON.stringify({
          type: "not_a_real_event",
          timestamp: new Date().toISOString()
        }),
        JSON.stringify({
          type: "eval_event_recorded",
          timestamp: new Date().toISOString(),
          sessionId: "raw-existing-session",
          metadata: {
            apiKey: "raw-existing-api-key"
          }
        })
      ].join("\n"),
      "utf8"
    );
    const sink = new JsonlTelemetrySink(filePath);

    const result = queryTelemetry(sink, {
      sessionId: "raw-existing-session",
      includeMetadata: true
    });
    const responseText = JSON.stringify(result);

    expect(result.total).toBe(1);
    expect(result.events[0]?.sessionIdHash).toBe(hashSessionId("raw-existing-session"));
    expect(result.events[0]?.metadata?.apiKey).toBe("<redacted>");
    expect(responseText).not.toContain("raw-existing-session");
    expect(responseText).not.toContain("raw-existing-api-key");
  });
});

function tempTelemetryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "oss-harness-telemetry-"));
  tempDirs.push(dir);
  return join(dir, "telemetry.jsonl");
}

class JsonlFakeProvider implements ProviderAdapter {
  readonly supportedModels: CanonicalModelId[] = [
    "kimi-k2-6",
    "deepseek-v4-pro",
    "deepseek-flash"
  ];
  readonly calls: ProviderChatRequest[] = [];

  constructor(
    readonly id: ProviderId,
    readonly capabilities: Required<CapabilityFlags>
  ) {}

  async completeChat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    this.calls.push(request);
    return { content: `ok from ${this.id}` };
  }
}

function registerTelemetryTools(telemetry: JsonlTelemetrySink): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    }
  } as unknown as McpServer;

  registerTools(server, {
    router: {} as ChatRouter,
    telemetry
  });

  return handlers;
}

function parseToolResult(result: Awaited<ReturnType<ToolHandler>>): unknown {
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}
