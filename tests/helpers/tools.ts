import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChatRouter } from "../../src/router/chatRouter.js";
import { InMemoryTelemetrySink } from "../../src/telemetry/memory.js";
import type { TelemetrySink } from "../../src/telemetry/types.js";
import { registerTools } from "../../src/tools/index.js";

export type ToolHandler = (input: unknown) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

export function makeRegisteredTools(
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

export function parseToolResult(result: Awaited<ReturnType<ToolHandler>>): unknown {
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}
