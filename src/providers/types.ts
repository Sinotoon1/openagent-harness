import type {
  CanonicalModelId,
  CapabilityFlags,
  ChatMessage,
  FallbackPhase,
  ProviderId
} from "../types.js";

export interface ProviderChatRequest {
  modelId: CanonicalModelId;
  sessionId: string;
  messages: ChatMessage[];
  capabilities: CapabilityFlags;
  temperature?: number;
  maxTokens?: number;
  streaming?: {
    enabled?: boolean;
    fallbackPhase?: FallbackPhase;
  };
  metadata?: Record<string, unknown>;
}

export interface ProviderChatResponse {
  content: string;
  raw?: unknown;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly supportedModels: CanonicalModelId[];
  readonly capabilities: Required<CapabilityFlags>;
  completeChat(request: ProviderChatRequest): Promise<ProviderChatResponse>;
}
