import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChatRouter } from "../router/chatRouter.js";
import { compactContext } from "../context/compact.js";
import { runPolicyDoctor } from "../diagnostics/policyDoctor.js";
import { inspectModelPolicies } from "../policies/inspect.js";
import { loadAllModelPolicies, loadModelPolicy } from "../policies/loader.js";
import { repairToolInput, repairToolInputWithSpec } from "../repair/engine.js";
import type { RepairToolInputResult } from "../repair/engine.js";
import {
  buildRepairSchemaSpecFromDescriptor,
  callerDescriptorExpectedShape,
  findDangerousDescriptorKeyIssues
} from "../repair/schemaDescriptors.js";
import { sanitizeForResponse } from "../security/sanitize.js";
import { queryTelemetry } from "../telemetry/query.js";
import { createReviewableRepairPolicySuggestions } from "../telemetry/repairPolicySuggestions.js";
import { createRepairTelemetryReport } from "../telemetry/repairReport.js";
import { getHarnessStats } from "../telemetry/stats.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { canonicalModelIds, type CanonicalModelId } from "../types.js";
import {
  makeInvalidToolResponse,
  type IssueLike
} from "../validation/invalidResponse.js";
import { normalizeToolInput } from "./normalizeToolInput.js";
import type { NormalizeToolInputResult } from "./normalizeToolInput.js";
import {
  compactContextInputSchema,
  getHarnessStatsInputSchema,
  getModelPolicyInputSchema,
  inspectModelPoliciesInputSchema,
  ossChatInputSchema,
  queryTelemetryInputSchema,
  recordEvalEventInputSchema,
  repairToolInputSchema,
  runPolicyDoctorInputSchema,
  suggestRepairPolicyInputSchema
} from "./schemas.js";

export interface ToolDependencies {
  router: ChatRouter;
  telemetry: TelemetrySink;
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  server.registerTool(
    "oss_chat",
    {
      title: "OSS Chat",
      description:
        "Route a chat request through canonical OSS model IDs, provider priority, capability negotiation, and retryable fallback.",
      inputSchema: ossChatInputSchema.shape
    },
    async (input) => {
      const parsed = ossChatInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(deps, "oss_chat", parsed.error.issues, expectedShapes.oss_chat);
      }

      try {
        return asPreSanitizedJsonText(await deps.router.route(parsed.data));
      } catch (error) {
        return asJsonText(
          {
            error: error instanceof Error ? error.message : "oss_chat failed"
          },
          true
        );
      }
    }
  );

  server.registerTool(
    "repair_tool_input",
    {
      title: "Repair Tool Input",
      description:
        "Validate a tool input first, then apply model-policy repairs and validate again.",
      inputSchema: repairToolInputSchema.shape
    },
    async (input) => {
      const dangerousDescriptorIssues = findDangerousDescriptorKeyIssues(input);
      if (dangerousDescriptorIssues.length > 0) {
        return invalidToolInput(
          deps,
          "repair_tool_input",
          dangerousDescriptorIssues,
          callerDescriptorExpectedShape
        );
      }

      const parsed = repairToolInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "repair_tool_input",
          parsed.error.issues,
          expectedShapes.repair_tool_input
        );
      }

      const hasBuiltInSchema = parsed.data.schemaName !== undefined;
      const hasSchemaDescriptor = parsed.data.schemaDescriptor !== undefined;
      if (hasBuiltInSchema === hasSchemaDescriptor) {
        return invalidToolInput(
          deps,
          "repair_tool_input",
          [
            {
              code: "invalid_value",
              path: ["schemaName"],
              message: "Provide exactly one of schemaName or schemaDescriptor."
            }
          ],
          expectedShapes.repair_tool_input
        );
      }

      if (parsed.data.schemaDescriptor) {
        const buildResult = buildRepairSchemaSpecFromDescriptor(parsed.data.schemaDescriptor);
        if (!buildResult.valid) {
          return invalidToolInput(
            deps,
            "repair_tool_input",
            buildResult.issues,
            callerDescriptorExpectedShape
          );
        }

        const repairResult = repairToolInputWithSpec(
          parsed.data.modelId,
          buildResult.spec,
          parsed.data.input,
          {
            sessionId: parsed.data.sessionId,
            telemetry: deps.telemetry,
            toolName: "repair_tool_input"
          }
        );

        return asJsonText(toRepairToolResponse(repairResult), !repairResult.valid);
      }

      const schemaName = parsed.data.schemaName;
      if (schemaName === undefined) {
        return invalidToolInput(
          deps,
          "repair_tool_input",
          [
            {
              code: "invalid_value",
              path: ["schemaName"],
              message: "schemaName is required when schemaDescriptor is not provided."
            }
          ],
          expectedShapes.repair_tool_input
        );
      }

      const repairResult = repairToolInput(
        parsed.data.modelId,
        schemaName,
        parsed.data.input,
        {
          sessionId: parsed.data.sessionId,
          telemetry: deps.telemetry,
          toolName: "repair_tool_input"
        }
      );

      if (!repairResult.valid) {
        return asJsonText(toRepairToolResponse(repairResult), true);
      }

      const normalizationResult = normalizeToolInput(
        schemaName,
        repairResult.data,
        {
          sessionId: parsed.data.sessionId,
          modelId: parsed.data.modelId,
          telemetry: deps.telemetry,
          toolName: "repair_tool_input"
        }
      );

      return asJsonText(toRepairToolResponse(repairResult, normalizationResult));
    }
  );

  server.registerTool(
    "compact_context",
    {
      title: "Compact Context",
      description:
        "Compact old context using effective model context tokens while preserving the in-flight task.",
      inputSchema: compactContextInputSchema.shape
    },
    async (input) => {
      const parsed = compactContextInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "compact_context",
          parsed.error.issues,
          expectedShapes.compact_context
        );
      }

      return asJsonText(compactContext(parsed.data, deps.telemetry));
    }
  );

  server.registerTool(
    "get_model_policy",
    {
      title: "Get Model Policy",
      description:
        "Return repair policy and effective context token settings for canonical model IDs.",
      inputSchema: getModelPolicyInputSchema.shape
    },
    async (input) => {
      const parsed = getModelPolicyInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "get_model_policy",
          parsed.error.issues,
          expectedShapes.get_model_policy
        );
      }

      return asJsonText(
        parsed.data.modelId ? loadModelPolicy(parsed.data.modelId) : loadAllModelPolicies()
      );
    }
  );

  server.registerTool(
    "inspect_model_policies",
    {
      title: "Inspect Model Policies",
      description:
        "Return sanitized, read-only model policy summaries with validation warnings.",
      inputSchema: inspectModelPoliciesInputSchema.shape
    },
    async (input) => {
      const parsed = inspectModelPoliciesInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "inspect_model_policies",
          parsed.error.issues,
          expectedShapes.inspect_model_policies
        );
      }

      const modelId = parsed.data.modelId;
      if (modelId !== undefined && !isCanonicalModelId(modelId)) {
        return invalidToolInput(
          deps,
          "inspect_model_policies",
          [
            {
              code: "invalid_value",
              path: ["modelId"],
              message: `Unknown modelId ${modelId}. Expected one of: ${canonicalModelIds.join(", ")}.`
            }
          ],
          expectedShapes.inspect_model_policies
        );
      }

      const policies =
        modelId === undefined ? loadAllModelPolicies() : [loadModelPolicy(modelId)];

      return asJsonText(inspectModelPolicies(policies, parsed.data));
    }
  );

  server.registerTool(
    "run_policy_doctor",
    {
      title: "Run Policy Doctor",
      description:
        "Return a sanitized, read-only harness health report for policies, provider config, and telemetry suggestions.",
      inputSchema: runPolicyDoctorInputSchema.shape
    },
    async (input) => {
      const parsed = runPolicyDoctorInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInputWithoutTelemetry(
          "run_policy_doctor",
          parsed.error.issues,
          expectedShapes.run_policy_doctor
        );
      }

      const modelId = parsed.data.modelId;
      if (modelId !== undefined && !isCanonicalModelId(modelId)) {
        return invalidToolInputWithoutTelemetry(
          "run_policy_doctor",
          [
            {
              code: "invalid_value",
              path: ["modelId"],
              message: `Unknown modelId ${modelId}. Expected one of: ${canonicalModelIds.join(", ")}.`
            }
          ],
          expectedShapes.run_policy_doctor
        );
      }

      const doctorInput =
        modelId === undefined
          ? {
              includeTelemetry: parsed.data.includeTelemetry,
              includeProviderConfig: parsed.data.includeProviderConfig,
              includeSuggestions: parsed.data.includeSuggestions,
              severity: parsed.data.severity
            }
          : {
              modelId,
              includeTelemetry: parsed.data.includeTelemetry,
              includeProviderConfig: parsed.data.includeProviderConfig,
              includeSuggestions: parsed.data.includeSuggestions,
              severity: parsed.data.severity
            };

      return asJsonText(runPolicyDoctor(doctorInput, { telemetry: deps.telemetry }));
    }
  );

  server.registerTool(
    "record_eval_event",
    {
      title: "Record Eval Event",
      description: "Record a harness evaluation event in telemetry.",
      inputSchema: recordEvalEventInputSchema.shape
    },
    async (input) => {
      const parsed = recordEvalEventInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "record_eval_event",
          parsed.error.issues,
          expectedShapes.record_eval_event
        );
      }

      deps.telemetry.record({
        type: "eval_event_recorded",
        sessionId: parsed.data.sessionId,
        modelId: parsed.data.modelId,
        metadata: {
          eventName: parsed.data.eventName,
          outcome: parsed.data.outcome,
          score: parsed.data.score,
          metadata: parsed.data.metadata
        }
      });

      return asJsonText({ recorded: true });
    }
  );

  server.registerTool(
    "query_telemetry",
    {
      title: "Query Telemetry",
      description: "Query in-memory harness telemetry with bounded, redacted metadata.",
      inputSchema: queryTelemetryInputSchema.shape
    },
    async (input) => {
      const parsed = queryTelemetryInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "query_telemetry",
          parsed.error.issues,
          expectedShapes.query_telemetry
        );
      }

      return asJsonText(queryTelemetry(deps.telemetry, parsed.data));
    }
  );

  server.registerTool(
    "get_harness_stats",
    {
      title: "Get Harness Stats",
      description: "Summarize recent sanitized in-memory harness telemetry.",
      inputSchema: getHarnessStatsInputSchema.shape
    },
    async (input) => {
      const parsed = getHarnessStatsInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "get_harness_stats",
          parsed.error.issues,
          expectedShapes.get_harness_stats
        );
      }

      return asPreSanitizedJsonText(getHarnessStats(deps.telemetry, parsed.data));
    }
  );

  server.registerTool(
    "suggest_repair_policy",
    {
      title: "Suggest Repair Policy",
      description:
        "Suggest per-model repair policy ordering from repair telemetry without editing YAML policies.",
      inputSchema: suggestRepairPolicyInputSchema.shape
    },
    async (input) => {
      const parsed = suggestRepairPolicyInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps,
          "suggest_repair_policy",
          parsed.error.issues,
          expectedShapes.suggest_repair_policy
        );
      }

      const telemetryWindow = queryTelemetry(deps.telemetry, {
        type: "tool_input_repaired",
        includeMetadata: true,
        limit: 200
      });
      const report = createRepairTelemetryReport(telemetryWindow.events);

      const suggestions = Object.entries(report.models)
        .filter(([modelId]) => parsed.data.modelId === undefined || modelId === parsed.data.modelId)
        .map(([modelId, suggestion]) => ({
          modelId,
          totalRepairEvents: suggestion.totalRepairEvents,
          repairCounts: suggestion.repairCounts,
          currentPolicyOrder: tryLoadPolicyRepairOrder(modelId),
          suggestedRepairOrder: suggestion.suggestedRepairOrder
        }));
      const policySuggestions = createReviewableRepairPolicySuggestions(telemetryWindow.events, {
        modelId: parsed.data.modelId,
        limit: 200,
        currentRepairsForModel: tryLoadPolicyRepairOrder
      });

      return asJsonText({
        suggestions,
        policySuggestions,
        note: "No YAML policies were modified."
      });
    }
  );
}

function asJsonText(data: unknown, isError = false) {
  const sanitized = sanitizeForResponse(data);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(sanitized, null, 2)
      }
    ],
    isError
  };
}

function asPreSanitizedJsonText(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function toRepairToolResponse(
  repairResult: RepairToolInputResult,
  normalizationResult?: NormalizeToolInputResult
) {
  const allNotes = [...repairResult.notes, ...(normalizationResult?.notes ?? [])];
  const output =
    normalizationResult?.valid && normalizationResult.data !== undefined
      ? normalizationResult.data
      : repairResult.data ?? repairResult.repairedInput;

  return {
    valid: repairResult.valid,
    repaired: repairResult.repaired,
    normalized: normalizationResult?.normalized ?? false,
    schemaName: repairResult.schemaName,
    modelId: repairResult.modelId,
    repairsApplied: unique(
      repairResult.notes
        .filter((note) => note.code.startsWith("repair."))
        .map((note) => note.code.replace(/^repair\./, ""))
    ),
    changedPaths: unique(allNotes.map((note) => note.path).filter(isString)),
    notes: allNotes,
    normalizationNotes: normalizationResult?.notes ?? [],
    sanitizedOutputPreview: sanitizeForResponse(output, {
      maxDepth: 3,
      maxArrayLength: 10,
      maxObjectKeys: 20,
      maxStringLength: 160
    }),
    modelMessage: repairResult.modelMessage,
    issues: repairResult.issues,
    error: repairResult.error
  };
}

const expectedShapes = {
  oss_chat:
    "{ modelId: canonicalModelId; sessionId: string; messages: ChatMessage[]; providerPriority?: ProviderId[]; capabilities?: CapabilityFlags; temperature?: number; maxTokens?: number; streaming?: { enabled?: boolean }; includeRawProviderResponse?: boolean; metadata?: object }",
  repair_tool_input:
    "{ modelId: canonicalModelId; input: unknown; sessionId?: string; schemaName?: oss_chat | readFile | writeFile | pathBatch; schemaDescriptor?: { toolName: string; schema: callerRepairSchema; pathStringFields?: string[]; pathStringArrayFields?: string[] }; provide exactly one of schemaName or schemaDescriptor }",
  compact_context:
    "{ modelId: canonicalModelId; messages: ChatMessage[]; sessionId?: string; usedTokens?: nonnegative integer; inFlightTaskMessageIds?: string[] }",
  get_model_policy: "{ modelId?: canonicalModelId }",
  inspect_model_policies:
    "{ modelId?: string; includeProviders?: boolean; includeRepairs?: boolean; includeContext?: boolean; includeOverrides?: boolean; includeWarnings?: boolean }",
  run_policy_doctor:
    "{ modelId?: string; includeTelemetry?: boolean; includeProviderConfig?: boolean; includeSuggestions?: boolean; severity?: info | warning | error }",
  record_eval_event:
    "{ eventName: string; sessionId?: string; modelId?: canonicalModelId; outcome?: pass | fail | skip | error; score?: number; metadata?: object }",
  query_telemetry:
    "{ type?: telemetryEventType; modelId?: canonicalModelId; providerId?: ProviderId; toolName?: string; sessionId?: string; limit?: 1..200; includeMetadata?: boolean }",
  get_harness_stats:
    "{ modelId?: canonicalModelId; sessionId?: string; eventType?: string; limit?: 1..200; includeProviders?: boolean }",
  suggest_repair_policy: "{ modelId?: canonicalModelId }"
} as const;

function invalidToolInput(
  deps: ToolDependencies,
  toolName: string,
  issues: readonly IssueLike[],
  expectedShape: string
) {
  const response = makeInvalidToolResponse({
    toolName,
    issues,
    expectedShape
  });

  deps.telemetry.record({
    type: "tool_input_invalid",
    toolName,
    metadata: {
      issues: response.issues
    }
  });

  return asJsonText(response, true);
}

function invalidToolInputWithoutTelemetry(
  toolName: string,
  issues: readonly IssueLike[],
  expectedShape: string
) {
  return asJsonText(
    makeInvalidToolResponse({
      toolName,
      issues,
      expectedShape
    }),
    true
  );
}

function tryLoadPolicyRepairOrder(modelId: string): string[] | undefined {
  try {
    return loadModelPolicy(modelId as never).repairs;
  } catch {
    return undefined;
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCanonicalModelId(value: string): value is CanonicalModelId {
  return (canonicalModelIds as readonly string[]).includes(value);
}
