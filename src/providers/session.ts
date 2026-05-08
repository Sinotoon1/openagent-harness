import { createHash } from "node:crypto";
import { stickySessionStrategy } from "../constants/provider.js";
import type { ProviderRuntimeConfig } from "./config.js";

export function stableSessionPin(providerConfig: ProviderRuntimeConfig, sessionId: string): string {
  return createHash("sha256")
    .update(`${providerConfig.id}:${sessionId}`)
    .digest("hex")
    .slice(0, 32);
}

export function buildStickySessionHeaders(
  providerConfig: ProviderRuntimeConfig,
  sessionId: string
): Record<string, string> {
  const value =
    providerConfig.stickySession.strategy === stickySessionStrategy.raw
      ? sessionId
      : stableSessionPin(providerConfig, sessionId);

  return {
    [providerConfig.stickySession.header]: value
  };
}
