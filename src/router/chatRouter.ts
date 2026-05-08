import type { ProviderAdapter } from "../providers/types.js";
import { ProviderError } from "../providers/providerError.js";
import { fallbackPhase } from "../constants/fallback.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import { loadModelPolicy } from "../policies/loader.js";
import { sanitizeForResponse, sanitizeProviderPreview } from "../security/sanitize.js";
import type { TelemetrySink } from "../telemetry/types.js";
import type { OssChatInput, OssChatOutput, ProviderId } from "../types.js";
import { providerIds } from "../types.js";
import { CacheWarmthTracker } from "./cache.js";
import {
  applyProviderModelOverrides,
  negotiateCapabilities
} from "./capabilities.js";

export class ChatRouter {
  constructor(
    private readonly providers: ProviderAdapter[],
    private readonly telemetry: TelemetrySink,
    private readonly cacheWarmth = new CacheWarmthTracker()
  ) {}

  async route(input: OssChatInput): Promise<OssChatOutput> {
    const selectedProviders = this.selectProviders(input);

    if (selectedProviders.length === 0) {
      throw new ProviderError(`No configured provider supports ${input.modelId}`, {
        retryable: false
      });
    }

    const modelPolicy = loadModelPolicy(input.modelId);
    const attempts: OssChatOutput["attempts"] = [];

    for (const [index, provider] of selectedProviders.entries()) {
      const negotiation = negotiateCapabilities(input.capabilities, provider, {
        sessionId: input.sessionId,
        modelId: input.modelId,
        attemptIndex: index,
        telemetry: this.telemetry
      });
      const capabilities = applyProviderModelOverrides(
        modelPolicy,
        provider,
        negotiation.capabilities,
        {
          sessionId: input.sessionId,
          attemptIndex: index,
          telemetry: this.telemetry
        }
      );

      this.telemetry.record({
        type: telemetryEvent.capabilityNegotiated,
        sessionId: input.sessionId,
        modelId: input.modelId,
        providerId: provider.id,
        metadata: {
          attemptIndex: index,
          capabilities,
          droppedCapabilities: negotiation.droppedCapabilities
        }
      });

      const likelyWarm = this.cacheWarmth.markAndCheck(
        provider.id,
        input.modelId,
        input.sessionId
      );
      this.telemetry.record({
        type: likelyWarm ? telemetryEvent.cacheLikelyWarm : telemetryEvent.cacheLikelyCold,
        sessionId: input.sessionId,
        modelId: input.modelId,
        providerId: provider.id
      });

      try {
        const response = await provider.completeChat({
          ...input,
          capabilities
        });
        attempts.push({ providerId: provider.id });
        return {
          modelId: input.modelId,
          providerId: provider.id,
          content: response.content,
          usage: previewUsage(response.usage),
          finishReason: response.finishReason,
          capabilities,
          droppedCapabilities: negotiation.droppedCapabilities,
          attempts,
          rawProviderResponsePreview: input.includeRawProviderResponse
            ? previewRawProviderResponse(response.raw)
            : undefined
        };
      } catch (error) {
        const providerError = toProviderError(error, provider.id);
        attempts.push({
          providerId: provider.id,
          retryableFailure: providerError.retryable,
          fallbackPhase: providerError.fallbackPhase,
          errorMessage: providerError.message
        });

        const nextProvider = selectedProviders[index + 1];
        const canFallback =
          providerError.retryable &&
          providerError.fallbackPhase === fallbackPhase.beforeFirstToken &&
          nextProvider !== undefined;

        if (!canFallback) {
          throw providerError;
        }

        this.telemetry.record({
          type: telemetryEvent.providerFallback,
          sessionId: input.sessionId,
          modelId: input.modelId,
          providerId: provider.id,
          metadata: {
            fromProvider: provider.id,
            toProvider: nextProvider.id,
            fallbackPhase: providerError.fallbackPhase,
            reason: providerError.message
          }
        });
      }
    }

    throw new ProviderError("Provider routing exhausted unexpectedly", {
      retryable: false
    });
  }

  private selectProviders(input: OssChatInput): ProviderAdapter[] {
    const priority = input.providerPriority?.length
      ? input.providerPriority
      : ([...providerIds] as ProviderId[]);
    const byId = new Map(this.providers.map((provider) => [provider.id, provider]));

    return priority
      .map((providerId) => byId.get(providerId))
      .filter((provider): provider is ProviderAdapter => {
        return Boolean(provider?.supportedModels.includes(input.modelId));
      });
  }
}

function previewRawProviderResponse(raw: unknown): unknown {
  return sanitizeProviderPreview(raw, {
    maxDepth: 4,
    maxArrayLength: 5,
    maxObjectKeys: 20,
    maxStringLength: 160
  });
}

function previewUsage(usage: unknown): unknown {
  if (usage === undefined) {
    return undefined;
  }

  return sanitizeUsageValue(usage, 0);
}

function sanitizeUsageValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return sanitizeForResponse(value, { maxStringLength: 160 });
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (depth >= 3) {
    return "<omitted:max-depth>";
  }

  if (Array.isArray(value)) {
    const output = value.slice(0, 10).map((item) => sanitizeUsageValue(item, depth + 1));
    const omittedItems = value.length - output.length;
    if (omittedItems > 0) {
      output.push(`<omitted:${omittedItems}:items>`);
    }
    return output;
  }

  if (!isPlainRecord(value)) {
    return String(value);
  }

  const entries = Object.entries(value).slice(0, 20);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of entries) {
    if (isSensitiveUsageKey(key) && typeof nested !== "number") {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = sanitizeUsageValue(nested, depth + 1);
  }

  const omittedKeys = Object.keys(value).length - entries.length;
  if (omittedKeys > 0) {
    output.__omittedKeys = omittedKeys;
  }
  return output;
}

function isSensitiveUsageKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "authorization",
    "secret",
    "password",
    "bearer",
    "credential",
    "cookie",
    "session"
  ].some((fragment) => normalized.includes(fragment));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function toProviderError(error: unknown, providerId: ProviderId): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(
    error instanceof Error ? error.message : `Provider ${providerId} failed`,
    {
      retryable: false,
      providerId,
      fallbackPhase: fallbackPhase.beforeFirstToken,
      cause: error
    }
  );
}
