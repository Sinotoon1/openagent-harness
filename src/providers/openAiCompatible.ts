import type {
  CanonicalModelId,
  CapabilityFlags,
  FallbackPhase,
  ProviderId,
  ToolCall
} from "../types.js";
import { capabilityName } from "../constants/capabilities.js";
import { fallbackPhase as fallbackPhaseName } from "../constants/fallback.js";
import type { ProviderRuntimeConfig } from "./config.js";
import { ProviderError, isRetryableStatus } from "./providerError.js";
import { buildStickySessionHeaders } from "./session.js";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResponse
} from "./types.js";

type ModelSlugMap = Record<CanonicalModelId, string>;

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string };
  }>;
  usage?: unknown;
}

interface OpenAIChatCompletionChunk {
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: unknown;
    };
    message?: {
      content?: string | null;
      tool_calls?: unknown;
    };
  }>;
}

interface ToolCallAccumulator {
  index: number;
  id?: string;
  nameParts: string[];
  argumentParts: string[];
  hasData: boolean;
}

export interface OpenAICompatibleProviderConfig {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
  modelSlugs: Partial<ModelSlugMap>;
  capabilities: Required<CapabilityFlags>;
  providerConfig: ProviderRuntimeConfig;
  defaultHeaders?: Record<string, string>;
}

export class OpenAICompatibleProviderAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  readonly supportedModels: CanonicalModelId[];
  readonly capabilities: Required<CapabilityFlags>;

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly modelSlugs: Partial<ModelSlugMap>;
  private readonly providerConfig: ProviderRuntimeConfig;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.id = config.id;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.modelSlugs = config.modelSlugs;
    this.providerConfig = config.providerConfig;
    this.supportedModels = Object.keys(config.modelSlugs) as CanonicalModelId[];
    this.capabilities = config.capabilities;
    this.defaultHeaders = config.defaultHeaders ?? {};
  }

  async completeChat(request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const providerModel = this.toProviderModel(request.modelId);
    const url = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...buildStickySessionHeaders(this.providerConfig, request.sessionId)
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    if (request.capabilities[capabilityName.zeroDataRetention]) {
      headers["X-Zero-Data-Retention"] = "true";
    }

    if (request.capabilities[capabilityName.disallowPromptTraining]) {
      headers["X-Disallow-Prompt-Training"] = "true";
    }

    const stream = request.streaming?.enabled === true;
    const body: Record<string, unknown> = {
      model: providerModel,
      messages: request.messages.map(({ role, content }) => ({ role, content })),
      stream
    };

    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    if (request.maxTokens !== undefined) {
      body.max_tokens = request.maxTokens;
    }

    if (request.capabilities[capabilityName.thinking]) {
      body.thinking = { enabled: true };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new ProviderError(`Provider ${this.id} request failed`, {
        retryable: true,
        providerId: this.id,
        cause: error
      });
    }

    if (!response.ok) {
      const retryable = isRetryableStatus(response.status);
      throw new ProviderError(
        safeHttpErrorMessage(
          this.id,
          response.status,
          fallbackPhaseName.beforeFirstToken,
          retryable
        ),
        {
          retryable,
          status: response.status,
          providerId: this.id,
          fallbackPhase: fallbackPhaseName.beforeFirstToken
        }
      );
    }

    if (stream) {
      return this.readStreamingResponse(response);
    }

    const data = (await response.json()) as OpenAIChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new ProviderError(`Provider ${this.id} returned no message content`, {
        retryable: false,
        providerId: this.id
      });
    }

    return {
      content,
      usage: data.usage,
      finishReason: finishReasonFromChoices(data.choices),
      raw: data
    };
  }

  private async readStreamingResponse(response: Response): Promise<ProviderChatResponse> {
    if (!response.body) {
      throw new ProviderError(`Provider ${this.id} returned no stream body`, {
        retryable: true,
        providerId: this.id,
        fallbackPhase: fallbackPhaseName.beforeFirstToken
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const contentDeltas: string[] = [];
    const toolCallDeltas: unknown[] = [];
    const toolCallReconstructor = new ToolCallReconstructor();
    const chunks: OpenAIChatCompletionChunk[] = [];
    let finishReason: string | undefined;
    let buffer = "";
    let meaningfulOutputStarted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (
            this.processSseLine(line, {
              contentDeltas,
              toolCallDeltas,
              toolCallReconstructor,
              chunks,
              setFinishReason: (value) => {
                finishReason = value;
              }
            })
          ) {
            meaningfulOutputStarted = true;
          }
        }
      }

      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
          if (
            this.processSseLine(line, {
              contentDeltas,
              toolCallDeltas,
              toolCallReconstructor,
              chunks,
              setFinishReason: (value) => {
                finishReason = value;
              }
            })
          ) {
            meaningfulOutputStarted = true;
          }
        }
      }
    } catch (error) {
      throw this.toStreamingProviderError(error, meaningfulOutputStarted, contentDeltas.join(""));
    } finally {
      reader.releaseLock();
    }

    return {
      content: contentDeltas.join(""),
      toolCalls: toolCallReconstructor.toToolCalls(),
      finishReason,
      raw: {
        chunks,
        toolCallDeltas,
        streamed: true
      }
    };
  }

  private processSseLine(
    line: string,
    output: {
      contentDeltas: string[];
      toolCallDeltas: unknown[];
      toolCallReconstructor: ToolCallReconstructor;
      chunks: OpenAIChatCompletionChunk[];
      setFinishReason: (value: string) => void;
    }
  ): boolean {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) {
      return false;
    }

    const payload = trimmed.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      return false;
    }

    let chunk: OpenAIChatCompletionChunk;
    try {
      chunk = JSON.parse(payload) as OpenAIChatCompletionChunk;
    } catch (error) {
      throw new Error(`Malformed provider SSE JSON: ${payload.slice(0, 160)}`, {
        cause: error
      });
    }

    output.chunks.push(chunk);
    const finishReason = finishReasonFromChoices(chunk.choices);
    if (finishReason) {
      output.setFinishReason(finishReason);
    }
    return this.collectMeaningfulDeltas(chunk, output);
  }

  private collectMeaningfulDeltas(
    chunk: OpenAIChatCompletionChunk,
    output: {
      contentDeltas: string[];
      toolCallDeltas: unknown[];
      toolCallReconstructor: ToolCallReconstructor;
    }
  ): boolean {
    let meaningful = false;

    for (const choice of chunk.choices ?? []) {
      const content = choice.delta?.content ?? choice.message?.content;
      if (typeof content === "string" && content.length > 0) {
        output.contentDeltas.push(content);
        meaningful = true;
      }

      const toolCalls = choice.delta?.tool_calls ?? choice.message?.tool_calls;
      if (toolCalls !== undefined) {
        output.toolCallDeltas.push(toolCalls);
        output.toolCallReconstructor.collect(toolCalls);
        meaningful = true;
      }
    }

    return meaningful;
  }

  private toStreamingProviderError(
    error: unknown,
    meaningfulOutputStarted: boolean,
    partialContent: string
  ): ProviderError {
    const phase: FallbackPhase = meaningfulOutputStarted
      ? fallbackPhaseName.afterFirstToken
      : fallbackPhaseName.beforeFirstToken;
    const message =
      phase === fallbackPhaseName.afterFirstToken
        ? `Provider ${this.id} stream failed after assistant output started; partial output cannot be merged with another provider`
        : `Provider ${this.id} stream failed before assistant output started`;

    return new ProviderError(message, {
      retryable: true,
      providerId: this.id,
      fallbackPhase: phase,
      cause: error,
      partialContent
    });
  }

  toProviderModel(modelId: CanonicalModelId): string {
    const slug = this.modelSlugs[modelId];

    if (!slug) {
      throw new ProviderError(`Provider ${this.id} does not support ${modelId}`, {
        retryable: false,
        providerId: this.id
      });
    }

    return slug;
  }
}

function safeHttpErrorMessage(
  providerId: ProviderId,
  status: number,
  fallbackPhase: FallbackPhase,
  retryable: boolean
): string {
  const retryability = retryable ? "retryable" : "non_retryable";
  return `Provider ${providerId} returned HTTP ${status} ${fallbackPhase} (${retryability}).`;
}

function finishReasonFromChoices(
  choices: Array<{ finish_reason?: string | null }> | undefined
): string | undefined {
  const finishReason = choices?.find((choice) => typeof choice.finish_reason === "string")
    ?.finish_reason;
  return finishReason ?? undefined;
}

class ToolCallReconstructor {
  private readonly calls = new Map<number, ToolCallAccumulator>();

  collect(toolCalls: unknown): void {
    if (!Array.isArray(toolCalls)) {
      return;
    }

    for (const [position, delta] of toolCalls.entries()) {
      if (!isPlainRecord(delta)) {
        continue;
      }

      const index = stableToolCallIndex(delta.index, position);
      const call = this.getOrCreate(index);

      if (typeof delta.id === "string" && delta.id.length > 0) {
        call.id = delta.id;
        call.hasData = true;
      }

      if (typeof delta.type === "string" && delta.type.length > 0) {
        call.hasData = true;
      }

      const functionDelta = delta.function;
      if (!isPlainRecord(functionDelta)) {
        continue;
      }

      if (typeof functionDelta.name === "string" && functionDelta.name.length > 0) {
        call.nameParts.push(functionDelta.name);
        call.hasData = true;
      }

      if (
        typeof functionDelta.arguments === "string" &&
        functionDelta.arguments.length > 0
      ) {
        call.argumentParts.push(functionDelta.arguments);
        call.hasData = true;
      }
    }
  }

  toToolCalls(): ToolCall[] | undefined {
    const toolCalls = [...this.calls.values()]
      .filter((call) => call.hasData)
      .sort((left, right) => left.index - right.index)
      .map((call) => ({
        ...(call.id !== undefined ? { id: call.id } : {}),
        type: "function" as const,
        function: {
          name: call.nameParts.join(""),
          arguments: call.argumentParts.join("")
        }
      }));

    return toolCalls.length > 0 ? toolCalls : undefined;
  }

  private getOrCreate(index: number): ToolCallAccumulator {
    const existing = this.calls.get(index);
    if (existing) {
      return existing;
    }

    const created: ToolCallAccumulator = {
      index,
      nameParts: [],
      argumentParts: [],
      hasData: false
    };
    this.calls.set(index, created);
    return created;
  }
}

function stableToolCallIndex(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
