import { ChatRouter } from "../../src/router/chatRouter.js";
import { OpenAICompatibleProviderAdapter } from "../../src/providers/openAiCompatible.js";
import type { ProviderRuntimeConfig } from "../../src/providers/config.js";
import type { ProviderAdapter } from "../../src/providers/types.js";
import { InMemoryTelemetrySink } from "../../src/telemetry/memory.js";
import type { CapabilityFlags, ProviderId } from "../../src/types.js";
import { makeRegisteredTools, type ToolHandler } from "./tools.js";

export const testProviderCapabilities: Required<CapabilityFlags> = {
  zeroDataRetention: true,
  disallowPromptTraining: true,
  thinking: true
};

export function testProviderConfig(id: ProviderId): ProviderRuntimeConfig {
  return {
    id,
    stickySession: {
      header: "X-Session-Id",
      strategy: "raw"
    }
  };
}

export function createOpenAIProvider(
  id: ProviderId,
  baseUrl: string
): OpenAICompatibleProviderAdapter {
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

export function makeRegisteredToolsWithProviders(providers: ProviderAdapter[]) {
  const telemetry = new InMemoryTelemetrySink();
  const registered = makeRegisteredTools(telemetry, new ChatRouter(providers, telemetry));
  return { ...registered, telemetry };
}

export async function callOssChat(
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
