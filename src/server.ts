#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProviderAdaptersFromEnv } from "./providers/registry.js";
import { ChatRouter } from "./router/chatRouter.js";
import { createTelemetrySinkFromEnv } from "./telemetry/config.js";
import { registerTools } from "./tools/index.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "oss-agent-harness-mcp",
    version: "1.0.0-candidate.8"
  });
  const telemetry = createTelemetrySinkFromEnv();
  const router = new ChatRouter(createProviderAdaptersFromEnv(), telemetry);

  registerTools(server, {
    router,
    telemetry
  });

  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
