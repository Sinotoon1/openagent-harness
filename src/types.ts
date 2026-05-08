import type { CapabilityName } from "./constants/capabilities.js";
import type { FallbackPhase } from "./constants/fallback.js";
export { capabilityNames, type CapabilityName } from "./constants/capabilities.js";
export { type FallbackPhase } from "./constants/fallback.js";

export const canonicalModelIds = [
  "kimi-k2-6",
  "deepseek-v4-pro",
  "deepseek-v4-flash"
] as const;

export type CanonicalModelId = (typeof canonicalModelIds)[number];

export const providerIds = ["deepseekPrimary", "openrouterFallback"] as const;

export type ProviderId = (typeof providerIds)[number];

export type CapabilityFlags = Partial<Record<CapabilityName, boolean>>;

export interface Note {
  code: string;
  message: string;
  path?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  id?: string;
  status?: "live" | "dead" | "in_flight";
  toolName?: string;
  createdAt?: string;
}

export interface OssChatInput {
  modelId: CanonicalModelId;
  sessionId: string;
  messages: ChatMessage[];
  providerPriority?: ProviderId[];
  capabilities?: CapabilityFlags;
  temperature?: number;
  maxTokens?: number;
  streaming?: {
    enabled?: boolean;
  };
  includeRawProviderResponse?: boolean;
  metadata?: Record<string, unknown>;
}

export interface OssChatOutput {
  modelId: CanonicalModelId;
  providerId: ProviderId;
  content: string;
  usage?: unknown;
  finishReason?: string;
  capabilities: CapabilityFlags;
  droppedCapabilities: CapabilityName[];
  attempts: Array<{
    providerId: ProviderId;
    retryableFailure?: boolean;
    fallbackPhase?: FallbackPhase;
    errorMessage?: string;
  }>;
  rawProviderResponsePreview?: unknown;
}
