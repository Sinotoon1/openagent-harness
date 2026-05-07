import type { ProviderAdapter } from "../providers/types.js";
import { ProviderError } from "../providers/providerError.js";
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

    const attempts: OssChatOutput["attempts"] = [];

    for (const [index, provider] of selectedProviders.entries()) {
      const negotiation = negotiateCapabilities(input.capabilities, provider, {
        sessionId: input.sessionId,
        modelId: input.modelId,
        attemptIndex: index,
        telemetry: this.telemetry
      });
      const capabilities = applyProviderModelOverrides(
        input.modelId,
        provider.id,
        negotiation.capabilities,
        {
          sessionId: input.sessionId,
          attemptIndex: index,
          telemetry: this.telemetry
        }
      );

      this.telemetry.record({
        type: "capability_negotiated",
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
        type: likelyWarm ? "cache_likely_warm" : "cache_likely_cold",
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
          capabilities,
          droppedCapabilities: negotiation.droppedCapabilities,
          attempts,
          raw: response.raw
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
          providerError.fallbackPhase === "before_first_token" &&
          nextProvider !== undefined;

        if (!canFallback) {
          throw providerError;
        }

        this.telemetry.record({
          type: "provider_fallback",
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

function toProviderError(error: unknown, providerId: ProviderId): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  return new ProviderError(
    error instanceof Error ? error.message : `Provider ${providerId} failed`,
    {
      retryable: false,
      providerId,
      fallbackPhase: "before_first_token",
      cause: error
    }
  );
}
