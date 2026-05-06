import type { CanonicalModelId, ProviderId } from "../types.js";

export class CacheWarmthTracker {
  private readonly lastSeen = new Map<string, number>();

  constructor(private readonly warmWindowMs = 5 * 60 * 1000) {}

  markAndCheck(providerId: ProviderId, modelId: CanonicalModelId, sessionId: string): boolean {
    const key = `${providerId}:${modelId}:${sessionId}`;
    const now = Date.now();
    const previous = this.lastSeen.get(key);
    this.lastSeen.set(key, now);
    return previous !== undefined && now - previous <= this.warmWindowMs;
  }
}
