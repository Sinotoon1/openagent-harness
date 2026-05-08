import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { fallbackPhase } from "../src/constants/fallback.js";
import { stickySessionStrategies } from "../src/constants/provider.js";
import { repairExecutionOrder, repairName } from "../src/constants/repairNames.js";
import { telemetryEvent } from "../src/constants/telemetryEvents.js";
import { mcpToolNames } from "../src/constants/toolNames.js";
import { parseProviderRuntimeConfigs } from "../src/providers/config.js";
import { registerTools } from "../src/tools/index.js";
import { getHarnessStats } from "../src/telemetry/stats.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";

describe("central constants", () => {
  it("registered MCP tool names match the canonical constants", () => {
    const registered = new Set<string>();
    const server = {
      registerTool(name: string) {
        registered.add(name);
      }
    } as unknown as McpServer;

    registerTools(server, {
      router: {},
      telemetry: new InMemoryTelemetrySink()
    } as Parameters<typeof registerTools>[1]);

    expect([...registered].sort()).toEqual([...mcpToolNames].sort());
  });

  it("keeps the repair execution order unchanged", () => {
    expect(repairExecutionOrder).toEqual([
      repairName.stripNullOptional,
      repairName.emptyObjectToArray,
      repairName.parseJsonArrayString,
      repairName.bareStringToArray,
      repairName.markdownPathAutolinkUnwrap
    ]);
  });

  it("uses canonical telemetry and repair constants in harness stats", () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: telemetryEvent.toolInputRepaired,
      modelId: "deepseek-v4-pro",
      toolName: "repair_tool_input",
      metadata: {
        repairs: [repairName.bareStringToArray]
      }
    });
    telemetry.record({
      type: telemetryEvent.providerFallback,
      providerId: "deepseekPrimary",
      metadata: {
        fallbackPhase: fallbackPhase.beforeFirstToken
      }
    });

    const stats = getHarnessStats(telemetry);

    expect(stats.repairs.byRepair[repairName.bareStringToArray]).toBe(1);
    expect(stats.routing.byPhase.beforeFirstToken).toBe(1);
  });

  it("provider config still accepts the same sticky-session strategy values", () => {
    const configs = parseProviderRuntimeConfigs({
      providers: [
        providerConfig("deepseekPrimary", stickySessionStrategies[0]),
        providerConfig("openrouterFallback", stickySessionStrategies[1])
      ]
    });

    expect(configs.deepseekPrimary.stickySession.strategy).toBe("raw");
    expect(configs.openrouterFallback.stickySession.strategy).toBe("hash");
  });
});

function providerConfig(id: "deepseekPrimary" | "openrouterFallback", strategy: "raw" | "hash") {
  return {
    id,
    baseUrlEnv:
      id === "deepseekPrimary" ? "DEEPSEEK_PRIMARY_BASE_URL" : "OPENROUTER_FALLBACK_BASE_URL",
    authEnvVar:
      id === "deepseekPrimary" ? "DEEPSEEK_PRIMARY_API_KEY" : "OPENROUTER_FALLBACK_API_KEY",
    stickySession: {
      header: id === "deepseekPrimary" ? "X-Session-Id" : "X-Routing-Key",
      strategy
    },
    modelSlugs: {
      "deepseek-v4-pro": {
        default: "deepseek-v4-pro"
      }
    }
  };
}
