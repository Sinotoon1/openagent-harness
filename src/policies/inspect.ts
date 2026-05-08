import { canonicalModelIds } from "../types.js";
import {
  contextThresholdOrderViolations,
  contextThresholds,
  isRecord,
  providerOverrideDiagnostics,
  repairDiagnostics,
  stringValue
} from "./diagnosticHelpers.js";
import { modelPolicySchema } from "./types.js";

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
  return repairDiagnostics(policy.repairs).map((diagnostic) => {
    if (diagnostic.kind === "empty_repairs") {
      return {
        code: "empty_repairs",
        path: "repairs",
        message: "Policy enables no repairs."
      };
    }

    return {
      code: "unknown_repair",
      path: `repairs[${diagnostic.index}]`,
      message: `Policy references unknown repair ${diagnostic.repair}.`
    };
  });
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

  for (const violation of contextThresholdOrderViolations(policy)) {
    warnings.push({
      code: "context_threshold_order",
      path: `context.thresholds.${violation.nextKey}`,
      message: `${violation.nextKey} must be greater than or equal to ${violation.currentKey}.`
    });
  }

  return warnings;
}

function providerOverrideWarnings(overrides: unknown): PolicyWarning[] {
  return providerOverrideDiagnostics(overrides).map((diagnostic) => {
    switch (diagnostic.kind) {
      case "unknown_provider_override":
        return {
          code: "unknown_provider_override",
          path: `providerOverrides[${diagnostic.index}].providerId`,
          message: `Provider override references unknown providerId ${diagnostic.providerId}.`
        };
      case "duplicate_provider_override":
        return {
          code: "duplicate_provider_override",
          path: `providerOverrides[${diagnostic.index}].providerId`,
          message: `Duplicate provider override for ${diagnostic.providerId}; first entry is at providerOverrides[${diagnostic.firstIndex}].`
        };
      case "provider_override_no_effective_change":
        return {
          code: "provider_override_no_effective_change",
          path: `providerOverrides[${diagnostic.index}].thinking`,
          message: "Provider override leaves thinking unchanged and has no effective change."
        };
      case "invalid_provider_override_thinking":
        return {
          code: "invalid_provider_override_thinking",
          path: `providerOverrides[${diagnostic.index}].thinking`,
          message: `Provider override uses invalid thinking value ${diagnostic.thinking}.`
        };
    }
  });
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
