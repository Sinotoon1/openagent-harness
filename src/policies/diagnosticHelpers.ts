import { providerIds } from "../types.js";
import { providerThinkingOverrideValues, repairNames } from "./types.js";

export const orderedContextThresholdKeys = [
  "dropDeadToolCalls",
  "aggressiveDrop",
  "summarizeOldContext"
] as const;

export interface ContextThresholdOrderViolation {
  currentKey: string;
  nextKey: string;
}

export interface RepairDiagnostic {
  kind: "empty_repairs" | "unknown_repair";
  index?: number;
  repair?: string;
}

export interface ProviderOverrideDiagnostic {
  kind:
    | "unknown_provider_override"
    | "duplicate_provider_override"
    | "provider_override_no_effective_change"
    | "invalid_provider_override_thinking";
  index: number;
  providerId?: string;
  firstIndex?: number;
  thinking?: string;
}

const knownProviderIds = new Set<string>(providerIds);
const knownRepairNames = new Set<string>(repairNames);
const knownThinkingOverrides = new Set<string>(providerThinkingOverrideValues);

export function contextThresholds(policy: Record<string, unknown>): Record<string, number> {
  const rawThresholds = firstRecord(
    policy.contextThresholds,
    isRecord(policy.context) ? policy.context.thresholds : undefined
  );
  if (!rawThresholds) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawThresholds).filter((entry): entry is [string, number] => {
      return typeof entry[1] === "number";
    })
  );
}

export function contextThresholdOrderViolations(
  policy: Record<string, unknown>
): ContextThresholdOrderViolation[] {
  const thresholds = contextThresholds(policy);
  const violations: ContextThresholdOrderViolation[] = [];

  for (let index = 0; index < orderedContextThresholdKeys.length - 1; index += 1) {
    const currentKey = orderedContextThresholdKeys[index];
    const nextKey = orderedContextThresholdKeys[index + 1];
    const current = thresholds[currentKey];
    const next = thresholds[nextKey];
    if (current !== undefined && next !== undefined && current > next) {
      violations.push({ currentKey, nextKey });
    }
  }

  return violations;
}

export function repairDiagnostics(repairs: unknown): RepairDiagnostic[] {
  if (!Array.isArray(repairs)) {
    return [];
  }

  const diagnostics: RepairDiagnostic[] = [];
  if (repairs.length === 0) {
    diagnostics.push({ kind: "empty_repairs" });
  }

  for (const [index, repair] of repairs.entries()) {
    if (typeof repair === "string" && !knownRepairNames.has(repair)) {
      diagnostics.push({ kind: "unknown_repair", index, repair });
    }
  }

  return diagnostics;
}

export function providerOverrideDiagnostics(value: unknown): ProviderOverrideDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const diagnostics: ProviderOverrideDiagnostic[] = [];
  const seenProviderIndexes = new Map<string, number>();

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      continue;
    }

    const providerId = stringValue(item.providerId);
    if (providerId !== undefined) {
      if (!knownProviderIds.has(providerId)) {
        diagnostics.push({ kind: "unknown_provider_override", index, providerId });
      }

      const firstIndex = seenProviderIndexes.get(providerId);
      if (firstIndex !== undefined) {
        diagnostics.push({
          kind: "duplicate_provider_override",
          index,
          providerId,
          firstIndex
        });
      } else {
        seenProviderIndexes.set(providerId, index);
      }
    }

    const thinking = stringValue(item.thinking);
    if (thinking === "unchanged") {
      diagnostics.push({
        kind: "provider_override_no_effective_change",
        index,
        ...(providerId ? { providerId } : {})
      });
    } else if (thinking !== undefined && !knownThinkingOverrides.has(thinking)) {
      diagnostics.push({
        kind: "invalid_provider_override_thinking",
        index,
        thinking
      });
    }
  }

  return diagnostics;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}
