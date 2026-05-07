import { canonicalModelIds, providerIds } from "../types.js";
import {
  modelPolicySchema,
  providerThinkingOverrideValues,
  repairNames
} from "./types.js";

export interface PolicyInspectionOptions {
  includeProviders?: boolean;
  includeRepairs?: boolean;
  includeContext?: boolean;
  includeOverrides?: boolean;
  includeWarnings?: boolean;
}

export interface PolicyInspectionResult {
  models: ModelPolicySummary[];
}

export interface ModelPolicySummary {
  modelId: string;
  repairs?: string[];
  context?: {
    effectiveContextTokens?: number;
    thresholds?: Record<string, number>;
  };
  providerOverrides?: ProviderOverrideSummary[];
  warnings?: PolicyWarning[];
  valid: boolean;
}

export interface ProviderOverrideSummary {
  providerId?: string;
  thinking?: string;
  reason?: string;
}

export interface PolicyWarning {
  code: string;
  path: string;
  message: string;
}

const knownModelIds = new Set<string>(canonicalModelIds);
const knownProviderIds = new Set<string>(providerIds);
const knownRepairNames = new Set<string>(repairNames);
const knownThinkingOverrides = new Set<string>(providerThinkingOverrideValues);

const orderedThresholdKeys = [
  "dropDeadToolCalls",
  "aggressiveDrop",
  "summarizeOldContext"
] as const;

type NormalizedPolicyInspectionOptions = Required<PolicyInspectionOptions>;

export function inspectModelPolicies(
  policies: readonly unknown[],
  options: PolicyInspectionOptions = {}
): PolicyInspectionResult {
  const normalized = normalizeOptions(options);

  return {
    models: policies.map((policy) => summarizeModelPolicyForInspection(policy, normalized))
  };
}

export function summarizeModelPolicyForInspection(
  policy: unknown,
  options: PolicyInspectionOptions = {}
): ModelPolicySummary {
  const normalized = normalizeOptions(options);
  const record = isRecord(policy) ? policy : {};
  const warnings = collectPolicyWarnings(record);
  const summary: ModelPolicySummary = {
    modelId: stringValue(record.modelId) ?? "<unknown>",
    valid: modelPolicySchema.safeParse(policy).success
  };

  if (normalized.includeRepairs) {
    summary.repairs = stringArray(record.repairs);
  }

  if (normalized.includeContext) {
    summary.context = contextSummary(record);
  }

  if (normalized.includeProviders && normalized.includeOverrides) {
    summary.providerOverrides = providerOverrideSummaries(record.providerOverrides);
  }

  if (normalized.includeWarnings) {
    summary.warnings = normalized.includeProviders
      ? warnings
      : warnings.filter((warning) => !warning.path.startsWith("providerOverrides"));
  }

  return summary;
}

function collectPolicyWarnings(policy: Record<string, unknown>): PolicyWarning[] {
  return [
    ...modelWarnings(policy),
    ...repairWarnings(policy),
    ...contextWarnings(policy),
    ...providerOverrideWarnings(policy.providerOverrides)
  ];
}

function modelWarnings(policy: Record<string, unknown>): PolicyWarning[] {
  const modelId = stringValue(policy.modelId);
  if (modelId === undefined || knownModelIds.has(modelId)) {
    return [];
  }

  return [
    {
      code: "unknown_model_id",
      path: "modelId",
      message: `Policy references unknown modelId ${modelId}.`
    }
  ];
}

function repairWarnings(policy: Record<string, unknown>): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  const repairs = policy.repairs;
  if (!Array.isArray(repairs)) {
    return warnings;
  }

  if (repairs.length === 0) {
    warnings.push({
      code: "empty_repairs",
      path: "repairs",
      message: "Policy enables no repairs."
    });
  }

  for (const [index, repair] of repairs.entries()) {
    if (typeof repair === "string" && !knownRepairNames.has(repair)) {
      warnings.push({
        code: "unknown_repair",
        path: `repairs[${index}]`,
        message: `Policy references unknown repair ${repair}.`
      });
    }
  }

  return warnings;
}

function contextWarnings(policy: Record<string, unknown>): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  if (typeof policy.effectiveContextTokens !== "number") {
    warnings.push({
      code: "missing_effective_context_tokens",
      path: "effectiveContextTokens",
      message: "Policy is missing effectiveContextTokens."
    });
  }

  const thresholds = contextThresholds(policy);
  for (let index = 0; index < orderedThresholdKeys.length - 1; index += 1) {
    const currentKey = orderedThresholdKeys[index];
    const nextKey = orderedThresholdKeys[index + 1];
    const current = thresholds[currentKey];
    const next = thresholds[nextKey];
    if (current !== undefined && next !== undefined && current > next) {
      warnings.push({
        code: "context_threshold_order",
        path: `context.thresholds.${nextKey}`,
        message: `${nextKey} must be greater than or equal to ${currentKey}.`
      });
    }
  }

  return warnings;
}

function providerOverrideWarnings(value: unknown): PolicyWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const warnings: PolicyWarning[] = [];
  const seenProviderIndexes = new Map<string, number>();

  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      continue;
    }

    const providerId = stringValue(item.providerId);
    if (providerId !== undefined) {
      if (!knownProviderIds.has(providerId)) {
        warnings.push({
          code: "unknown_provider_override",
          path: `providerOverrides[${index}].providerId`,
          message: `Provider override references unknown providerId ${providerId}.`
        });
      }

      const firstIndex = seenProviderIndexes.get(providerId);
      if (firstIndex !== undefined) {
        warnings.push({
          code: "duplicate_provider_override",
          path: `providerOverrides[${index}].providerId`,
          message: `Duplicate provider override for ${providerId}; first entry is at providerOverrides[${firstIndex}].`
        });
      } else {
        seenProviderIndexes.set(providerId, index);
      }
    }

    const thinking = stringValue(item.thinking);
    if (thinking === "unchanged") {
      warnings.push({
        code: "provider_override_no_effective_change",
        path: `providerOverrides[${index}].thinking`,
        message: "Provider override leaves thinking unchanged and has no effective change."
      });
    } else if (thinking !== undefined && !knownThinkingOverrides.has(thinking)) {
      warnings.push({
        code: "invalid_provider_override_thinking",
        path: `providerOverrides[${index}].thinking`,
        message: `Provider override uses invalid thinking value ${thinking}.`
      });
    }
  }

  return warnings;
}

function providerOverrideSummaries(value: unknown): ProviderOverrideSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((override) => ({
    ...(typeof override.providerId === "string" ? { providerId: override.providerId } : {}),
    ...(typeof override.thinking === "string" ? { thinking: override.thinking } : {}),
    ...(typeof override.reason === "string" ? { reason: override.reason } : {})
  }));
}

function contextSummary(policy: Record<string, unknown>): ModelPolicySummary["context"] {
  const thresholds = contextThresholds(policy);

  return {
    ...(typeof policy.effectiveContextTokens === "number"
      ? { effectiveContextTokens: policy.effectiveContextTokens }
      : {}),
    ...(Object.keys(thresholds).length > 0 ? { thresholds } : {})
  };
}

function contextThresholds(policy: Record<string, unknown>): Record<string, number> {
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

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function normalizeOptions(
  options: PolicyInspectionOptions
): NormalizedPolicyInspectionOptions {
  return {
    includeProviders: options.includeProviders ?? true,
    includeRepairs: options.includeRepairs ?? true,
    includeContext: options.includeContext ?? true,
    includeOverrides: options.includeOverrides ?? true,
    includeWarnings: options.includeWarnings ?? true
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
