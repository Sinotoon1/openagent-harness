import type { ProviderId } from "../types.js";
import type { FallbackPhase } from "../types.js";

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly providerId?: ProviderId;
  readonly fallbackPhase: FallbackPhase;
  readonly partialContent?: string;

  constructor(
    message: string,
    options: {
      retryable: boolean;
      status?: number;
      providerId?: ProviderId;
      fallbackPhase?: FallbackPhase;
      partialContent?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.providerId = options.providerId;
    this.fallbackPhase = options.fallbackPhase ?? "before_first_token";
    this.partialContent = options.partialContent;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
