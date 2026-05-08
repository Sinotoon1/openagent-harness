export const canonicalModelIds = [
  "kimi-k2-6",
  "deepseek-v4-pro",
  "deepseek-flash"
] as const;

export type CanonicalModelId = (typeof canonicalModelIds)[number];

export const providerIds = ["providerOne", "providerTwo"] as const;

export type ProviderId = (typeof providerIds)[number];

export const capabilityNames = [
  "zeroDataRetention",
  "disallowPromptTraining",
  "thinking"
] as const;

export type CapabilityName = (typeof capabilityNames)[number];

export type CapabilityFlags = Partial<Record<CapabilityName, boolean>>;

export type FallbackPhase = "before_first_token" | "after_first_token";

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
