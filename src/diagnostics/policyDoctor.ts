import { parseProviderRuntimeConfigs, loadProviderRuntimeConfigs } from "../providers/config.js";
import type { ProviderRuntimeConfigMap } from "../providers/config.js";
import { loadAllModelPolicies, loadModelPolicy } from "../policies/loader.js";
import { modelPolicySchema, repairNames } from "../policies/types.js";
import { createReviewableRepairPolicySuggestions } from "../telemetry/repairPolicySuggestions.js";
import { queryTelemetry } from "../telemetry/query.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { canonicalModelIds, providerIds } from "../types.js";
import type { CanonicalModelId } from "../types.js";

export type PolicyDoctorSeverity = "info" | "warning" | "error";
export type PolicyDoctorStatus = "ok" | "warning" | "error";

export interface PolicyDoctorInput {
  modelId?: CanonicalModelId;
  includeTelemetry?: boolean;
  includeProviderConfig?: boolean;
  includeSuggestions?: boolean;
  severity?: PolicyDoctorSeverity;
}

export interface PolicyDoctorIssue {
  severity: PolicyDoctorSeverity;
  code: string;
  message: string;
  modelId?: string;
  providerId?: string;
  recommendation: string;
}

export interface PolicyDoctorReport {
  status: PolicyDoctorStatus;
  summary: {
    modelsChecked: number;
    providersChecked: number;
    issues: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  issues: PolicyDoctorIssue[];
}

export interface PolicyDoctorDependencies {
  policies?: readonly unknown[];
  providerConfig?: unknown;
  env?: NodeJS.ProcessEnv;
  telemetry?: TelemetrySink;
}

const severityRank: Record<PolicyDoctorSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2
};

const knownRepairNames = new Set<string>(repairNames);
const knownProviderIds = new Set<string>(providerIds);
const knownModelIds = new Set<string>(canonicalModelIds);
const knownStickySessionStrategies = new Set(["raw", "hash"]);
const envVarNamePattern = /^[A-Z_][A-Z0-9_]*$/;
const orderedThresholdKeys = [
  "dropDeadToolCalls",
  "aggressiveDrop",
  "summarizeOldContext"
] as const;

export function runPolicyDoctor(
  input: PolicyDoctorInput = {},
  deps: PolicyDoctorDependencies = {}
): PolicyDoctorReport {
  const includeTelemetry = input.includeTelemetry ?? true;
  const includeProviderConfig = input.includeProviderConfig ?? true;
  const includeSuggestions = input.includeSuggestions ?? true;
  const issues: PolicyDoctorIssue[] = [];

  const policies = selectPolicies(input.modelId, deps.policies, issues);
  for (const policy of policies) {
    issues.push(...diagnosePolicy(policy));
  }
  issues.push(...diagnoseDeepSeekPolicyOverride(policies, input.modelId));

  const providersChecked = includeProviderConfig
    ? diagnoseProviderConfig(deps.providerConfig, deps.env ?? process.env, issues)
    : 0;

  if (includeTelemetry && deps.telemetry) {
    issues.push(...diagnoseTelemetry(deps.telemetry, policies, input.modelId, includeSuggestions));
  } else if (includeTelemetry && !deps.telemetry) {
    issues.push({
      severity: "info",
      code: "no_telemetry_available",
      message: "No telemetry sink was available to policy doctor.",
      recommendation: "Run with the MCP server telemetry sink attached to include telemetry checks."
    });
  }

  const filteredIssues = filterIssuesBySeverity(issues, input.severity);
  return buildReport(filteredIssues, {
    modelsChecked: policies.length,
    providersChecked
  });
}

function selectPolicies(
  modelId: CanonicalModelId | undefined,
  injectedPolicies: readonly unknown[] | undefined,
  issues: PolicyDoctorIssue[]
): unknown[] {
  if (injectedPolicies !== undefined) {
    if (modelId === undefined) {
      return [...injectedPolicies];
    }

    const selected = injectedPolicies.filter((policy) => recordModelId(policy) === modelId);
    if (selected.length === 0) {
      issues.push({
        severity: "error",
        code: "model_policy_not_found",
        message: `No loaded model policy was found for ${modelId}.`,
        modelId,
        recommendation: "Verify the canonical model policy exists and can be loaded."
      });
    }
    return selected;
  }

  if (modelId !== undefined) {
    try {
      return [loadModelPolicy(modelId)];
    } catch {
      issues.push({
        severity: "error",
        code: "model_policy_load_failed",
        message: `Model policy ${modelId} could not be loaded.`,
        modelId,
        recommendation: "Validate the model policy YAML and schema before routing this model."
      });
      return [];
    }
  }

  try {
    return loadAllModelPolicies();
  } catch {
    const loaded: unknown[] = [];
    for (const candidateModelId of canonicalModelIds) {
      try {
        loaded.push(loadModelPolicy(candidateModelId));
      } catch {
        issues.push({
          severity: "error",
          code: "model_policy_load_failed",
          message: `Model policy ${candidateModelId} could not be loaded.`,
          modelId: candidateModelId,
          recommendation: "Validate the model policy YAML and schema before routing this model."
        });
      }
    }
    return loaded;
  }
}

function diagnosePolicy(policy: unknown): PolicyDoctorIssue[] {
  const record = isRecord(policy) ? policy : {};
  const modelId = recordModelId(policy);
  const issues: PolicyDoctorIssue[] = [];
  const parsed = modelPolicySchema.safeParse(policy);

  if (!parsed.success) {
    issues.push({
      severity: "error",
      code: "model_policy_invalid",
      message: `Model policy ${modelId ?? "<unknown>"} does not match the strict policy schema.`,
      ...(modelId ? { modelId } : {}),
      recommendation: "Fix the policy YAML so it passes the existing model policy validation."
    });
  }

  issues.push(...diagnoseRepairs(record, modelId));
  issues.push(...diagnoseContext(record, modelId));
  issues.push(...diagnoseProviderOverrides(record.providerOverrides, modelId));

  return issues;
}

function diagnoseRepairs(
  policy: Record<string, unknown>,
  modelId: string | undefined
): PolicyDoctorIssue[] {
  const repairs = policy.repairs;
  if (!Array.isArray(repairs)) {
    return [
      {
        severity: "error",
        code: "repairs_invalid",
        message: "Model policy repairs must be an array.",
        ...(modelId ? { modelId } : {}),
        recommendation: "Set repairs to a YAML list of known repair names."
      }
    ];
  }

  const issues: PolicyDoctorIssue[] = [];
  if (repairs.length === 0) {
    issues.push({
      severity: "warning",
      code: "empty_repairs",
      message: "Model policy enables no repairs.",
      ...(modelId ? { modelId } : {}),
      recommendation: "Confirm this model intentionally bypasses all repair helpers."
    });
  }

  for (const repair of repairs) {
    if (typeof repair === "string" && !knownRepairNames.has(repair)) {
      issues.push({
        severity: "error",
        code: "unknown_repair_name",
        message: `Model policy references unknown repair ${repair}.`,
        ...(modelId ? { modelId } : {}),
        recommendation: "Use one of the known repair names from the harness repair policy schema."
      });
    }
  }

  return issues;
}

function diagnoseContext(
  policy: Record<string, unknown>,
  modelId: string | undefined
): PolicyDoctorIssue[] {
  const issues: PolicyDoctorIssue[] = [];
  if (
    typeof policy.effectiveContextTokens !== "number" ||
    !Number.isInteger(policy.effectiveContextTokens) ||
    policy.effectiveContextTokens <= 0
  ) {
    issues.push({
      severity: "error",
      code: "invalid_effective_context_tokens",
      message: "Model policy is missing a valid positive integer effectiveContextTokens value.",
      ...(modelId ? { modelId } : {}),
      recommendation: "Set effectiveContextTokens to the conservative usable context budget."
    });
  }

  const thresholds = contextThresholds(policy);
  for (let index = 0; index < orderedThresholdKeys.length - 1; index += 1) {
    const currentKey = orderedThresholdKeys[index];
    const nextKey = orderedThresholdKeys[index + 1];
    const current = thresholds[currentKey];
    const next = thresholds[nextKey];
    if (current !== undefined && next !== undefined && current > next) {
      issues.push({
        severity: "warning",
        code: "context_threshold_order",
        message: `${nextKey} should be greater than or equal to ${currentKey}.`,
        ...(modelId ? { modelId } : {}),
        recommendation: "Order context thresholds from earlier/more aggressive to later/less aggressive budget triggers."
      });
    }
  }

  return issues;
}

function diagnoseProviderOverrides(
  overrides: unknown,
  modelId: string | undefined
): PolicyDoctorIssue[] {
  if (!Array.isArray(overrides)) {
    return [];
  }

  const issues: PolicyDoctorIssue[] = [];
  const seen = new Map<string, number>();

  for (const [index, override] of overrides.entries()) {
    if (!isRecord(override)) {
      continue;
    }

    const providerId = typeof override.providerId === "string" ? override.providerId : undefined;
    if (providerId !== undefined) {
      if (!knownProviderIds.has(providerId)) {
        issues.push({
          severity: "warning",
          code: "unknown_provider_override",
          message: `Provider override references unknown providerId ${providerId}.`,
          ...(modelId ? { modelId } : {}),
          providerId,
          recommendation: "Remove the override or add a matching provider config owned by the provider layer."
        });
      }

      const firstIndex = seen.get(providerId);
      if (firstIndex !== undefined) {
        issues.push({
          severity: "warning",
          code: "duplicate_provider_override",
          message: `Duplicate provider override for ${providerId}; first entry is at index ${firstIndex}.`,
          ...(modelId ? { modelId } : {}),
          providerId,
          recommendation: "Keep one provider override per model/provider pair."
        });
      } else {
        seen.set(providerId, index);
      }
    }

    if (override.thinking === "unchanged") {
      issues.push({
        severity: "warning",
        code: "provider_override_no_effective_change",
        message: "Provider override leaves thinking unchanged and has no effective change.",
        ...(modelId ? { modelId } : {}),
        ...(providerId ? { providerId } : {}),
        recommendation: "Remove no-op overrides unless they are deliberately documenting a reviewed decision."
      });
    }
  }

  return issues;
}

function diagnoseDeepSeekPolicyOverride(
  policies: readonly unknown[],
  modelId: CanonicalModelId | undefined
): PolicyDoctorIssue[] {
  if (modelId !== undefined && modelId !== "deepseek-v4-pro") {
    return [];
  }

  const policy = policies.find((candidate) => recordModelId(candidate) === "deepseek-v4-pro");
  if (!policy) {
    return [];
  }

  const record = isRecord(policy) ? policy : {};
  const overrides = Array.isArray(record.providerOverrides) ? record.providerOverrides : [];
  const hasPolicyBackedOverride = overrides.some((override) => {
    return (
      isRecord(override) &&
      override.providerId === "providerTwo" &&
      override.thinking === "disabled"
    );
  });

  if (hasPolicyBackedOverride) {
    return [
      {
        severity: "info",
        code: "deepseek_override_policy_backed",
        message: "DeepSeek v4 Pro providerTwo thinking override is present in model policy.",
        modelId: "deepseek-v4-pro",
        providerId: "providerTwo",
        recommendation: "Keep this quirk policy-backed; do not reintroduce hardcoded routing behavior."
      }
    ];
  }

  return [
    {
      severity: "warning",
      code: "deepseek_override_missing",
      message: "DeepSeek v4 Pro providerTwo thinking override was not found in model policy.",
      modelId: "deepseek-v4-pro",
      providerId: "providerTwo",
      recommendation: "Keep the provider-specific thinking override in policy YAML if the quirk still applies."
    }
  ];
}

function diagnoseProviderConfig(
  providerConfig: unknown,
  env: NodeJS.ProcessEnv,
  issues: PolicyDoctorIssue[]
): number {
  const rawProviderConfig = providerConfig;
  issues.push(...diagnoseDuplicateProviderIds(rawProviderConfig));
  issues.push(...diagnoseProviderConfigShape(rawProviderConfig));

  let configs: ProviderRuntimeConfigMap;
  try {
    configs =
      rawProviderConfig === undefined
        ? loadProviderRuntimeConfigs()
        : parseProviderRuntimeConfigs(rawProviderConfig);
  } catch {
    issues.push({
      severity: "error",
      code: "provider_config_invalid",
      message: "Provider config failed static validation.",
      recommendation: "Fix provider IDs, environment variable names, sticky-session settings, and model slug mappings in provider config."
    });
    return 0;
  }

  for (const provider of Object.values(configs)) {
    if (!env[provider.baseUrlEnv]) {
      issues.push({
        severity: "info",
        code: "provider_base_url_env_missing",
        message: `Provider ${provider.id} is disabled because ${provider.baseUrlEnv} is not set.`,
        providerId: provider.id,
        recommendation: "Set the documented base URL environment variable only when this provider should be enabled."
      });
    }
  }

  return Object.keys(configs).length;
}

function diagnoseProviderConfigShape(providerConfig: unknown): PolicyDoctorIssue[] {
  if (!isRecord(providerConfig) || !Array.isArray(providerConfig.providers)) {
    return [];
  }

  const issues: PolicyDoctorIssue[] = [];
  for (const provider of providerConfig.providers) {
    if (!isRecord(provider)) {
      continue;
    }

    const providerId = typeof provider.id === "string" ? provider.id : undefined;
    const stickySession = provider.stickySession;
    if (
      isRecord(stickySession) &&
      typeof stickySession.strategy === "string" &&
      !knownStickySessionStrategies.has(stickySession.strategy)
    ) {
      issues.push({
        severity: "error",
        code: "invalid_sticky_session_strategy",
        message: "Provider config contains an invalid sticky session strategy.",
        ...(providerId ? { providerId } : {}),
        recommendation: "Use one of the existing sticky session strategies accepted by provider config validation."
      });
    }

    issues.push(...diagnoseModelSlugMappings(provider.modelSlugs, providerId));
  }

  return issues;
}

function diagnoseModelSlugMappings(
  modelSlugs: unknown,
  providerId: string | undefined
): PolicyDoctorIssue[] {
  if (!isRecord(modelSlugs)) {
    return [];
  }

  const issues: PolicyDoctorIssue[] = [];
  for (const [modelId, slugConfig] of Object.entries(modelSlugs)) {
    if (!knownModelIds.has(modelId)) {
      issues.push({
        severity: "error",
        code: "invalid_model_slug_mapping",
        message: "Provider config contains a model slug mapping for an unknown canonical model.",
        ...(providerId ? { providerId } : {}),
        recommendation: "Keep slug mappings keyed by canonical model IDs only."
      });
      continue;
    }

    if (!isRecord(slugConfig) || typeof slugConfig.default !== "string" || slugConfig.default === "") {
      issues.push({
        severity: "error",
        code: "invalid_model_slug_mapping",
        message: "Provider config contains an invalid model slug mapping shape.",
        ...(providerId ? { providerId } : {}),
        recommendation: "Each model slug mapping needs a non-empty default slug and optional environment variable name."
      });
      continue;
    }

    if (
      slugConfig.env !== undefined &&
      (typeof slugConfig.env !== "string" || !envVarNamePattern.test(slugConfig.env))
    ) {
      issues.push({
        severity: "error",
        code: "invalid_model_slug_mapping",
        message: "Provider config contains an invalid model slug environment variable name.",
        ...(providerId ? { providerId } : {}),
        recommendation: "Use uppercase environment variable names without exposing or validating their values."
      });
    }
  }

  return issues;
}

function diagnoseDuplicateProviderIds(providerConfig: unknown): PolicyDoctorIssue[] {
  if (!isRecord(providerConfig) || !Array.isArray(providerConfig.providers)) {
    return [];
  }

  const issues: PolicyDoctorIssue[] = [];
  const seen = new Set<string>();
  for (const provider of providerConfig.providers) {
    if (!isRecord(provider) || typeof provider.id !== "string") {
      continue;
    }

    if (seen.has(provider.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_provider_id",
        message: `Provider config contains duplicate provider id ${provider.id}.`,
        providerId: provider.id,
        recommendation: "Keep one provider config entry per provider ID."
      });
    }
    seen.add(provider.id);
  }

  return issues;
}

function diagnoseTelemetry(
  telemetry: TelemetrySink,
  policies: readonly unknown[],
  modelId: CanonicalModelId | undefined,
  includeSuggestions: boolean
): PolicyDoctorIssue[] {
  const issues: PolicyDoctorIssue[] = [
    {
      severity: "info",
      code: "telemetry_latest_window_bounded",
      message: "Telemetry diagnostics use a bounded latest window of at most 200 events.",
      recommendation: "Treat telemetry diagnostics as recent local evidence, not full-history analytics."
    },
    {
      severity: "info",
      code: "telemetry_sink_caveat",
      message: "Telemetry may be in-memory or local JSONL depending on harness configuration.",
      recommendation: "Use the configured local telemetry sink only for harness health diagnostics."
    }
  ];
  const telemetryWindow = queryTelemetry(telemetry, {
    ...(modelId ? { modelId } : {}),
    limit: 200
  });

  if (telemetryWindow.total === 0) {
    issues.push({
      severity: "info",
      code: "no_telemetry_available",
      message: "No telemetry events were available in the bounded latest window.",
      ...(modelId ? { modelId } : {}),
      recommendation: "Run the harness long enough to collect local telemetry before relying on telemetry-driven suggestions."
    });
  }

  if (!includeSuggestions) {
    return issues;
  }

  const repairedWindow = queryTelemetry(telemetry, {
    type: "tool_input_repaired",
    ...(modelId ? { modelId } : {}),
    includeMetadata: true,
    limit: 200
  });
  const suggestions = createReviewableRepairPolicySuggestions(repairedWindow.events, {
    modelId,
    limit: 200,
    currentRepairsForModel: (currentModelId) => policyRepairsForModel(policies, currentModelId)
  });

  for (const suggestion of suggestions) {
    if (suggestion.status === "suggested") {
      issues.push(
        {
          severity: "warning",
          code: "repair_policy_suggestion_not_applied",
          message: "Telemetry produced a repair policy suggestion that has not been applied.",
          modelId: suggestion.modelId,
          recommendation: "Review the suggestion manually; policy doctor will not edit YAML or auto-apply changes."
        },
        {
          severity: "warning",
          code: "suggested_repair_order_mismatch",
          message: "Telemetry-suggested repair order differs from the current model policy.",
          modelId: suggestion.modelId,
          recommendation: "Compare the suggested order with current policy before making any manual YAML change."
        }
      );
    }

    if (suggestion.warnings.some((warning) => warning.code === "unknown_repair_names")) {
      issues.push({
        severity: "warning",
        code: "telemetry_unknown_repair_names",
        message: "Telemetry suggestions included unknown repair names that were ignored.",
        modelId: suggestion.modelId,
        recommendation: "Investigate telemetry producers before trusting unknown repair names."
      });
    }
  }

  return issues;
}

function policyRepairsForModel(
  policies: readonly unknown[],
  modelId: string
): string[] | undefined {
  const policy = policies.find((candidate) => recordModelId(candidate) === modelId);
  if (!isRecord(policy) || !Array.isArray(policy.repairs)) {
    return undefined;
  }

  return policy.repairs.filter((repair): repair is string => typeof repair === "string");
}

function filterIssuesBySeverity(
  issues: readonly PolicyDoctorIssue[],
  minimumSeverity: PolicyDoctorSeverity | undefined
): PolicyDoctorIssue[] {
  if (minimumSeverity === undefined) {
    return [...issues];
  }

  const minimumRank = severityRank[minimumSeverity];
  return issues.filter((issue) => severityRank[issue.severity] >= minimumRank);
}

function buildReport(
  issues: PolicyDoctorIssue[],
  checked: { modelsChecked: number; providersChecked: number }
): PolicyDoctorReport {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const infos = issues.filter((issue) => issue.severity === "info").length;

  return {
    status: errors > 0 ? "error" : warnings > 0 ? "warning" : "ok",
    summary: {
      modelsChecked: checked.modelsChecked,
      providersChecked: checked.providersChecked,
      issues: issues.length,
      errors,
      warnings,
      infos
    },
    issues
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

function recordModelId(policy: unknown): string | undefined {
  return isRecord(policy) && typeof policy.modelId === "string" ? policy.modelId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
