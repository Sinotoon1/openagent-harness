import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ChatRouter } from "../router/chatRouter.js";
import { compactContext } from "../context/compact.js";
import { runPolicyDoctor } from "../diagnostics/policyDoctor.js";
import { mcpToolName } from "../constants/toolNames.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import { inspectModelPolicies } from "../policies/inspect.js";
import { loadAllModelPolicies, loadModelPolicy } from "../policies/loader.js";
import { repairToolInput, repairToolInputWithSpec } from "../repair/engine.js";
import {
  buildRepairSchemaSpecFromDescriptor,
  callerDescriptorExpectedShape,
  findDangerousDescriptorKeyIssues
} from "../repair/schemaDescriptors.js";
import { queryTelemetry } from "../telemetry/query.js";
import { createReviewableRepairPolicySuggestions } from "../telemetry/repairPolicySuggestions.js";
import { createRepairTelemetryReport } from "../telemetry/repairReport.js";
import { getHarnessStats } from "../telemetry/stats.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { canonicalModelIds, type CanonicalModelId } from "../types.js";
import { normalizeToolInput } from "./normalizeToolInput.js";
import { toRepairToolResponse } from "./repairResponses.js";
import {
  asJsonText,
  asPreSanitizedJsonText,
  expectedShapes,
  invalidToolInput,
  invalidToolInputWithoutTelemetry
} from "./responses.js";
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
    mcpToolName.ossChat,
    {
      title: "OSS Chat",
      description:
        "Route a chat request through canonical OSS model IDs, provider priority, capability negotiation, and retryable fallback.",
      inputSchema: ossChatInputSchema.shape
    },
    async (input) => {
      const parsed = ossChatInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.ossChat,
          parsed.error.issues,
          expectedShapes[mcpToolName.ossChat]
        );
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
    mcpToolName.repairToolInput,
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
          deps.telemetry,
          mcpToolName.repairToolInput,
          dangerousDescriptorIssues,
          callerDescriptorExpectedShape
        );
      }

      const parsed = repairToolInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.repairToolInput,
          parsed.error.issues,
          expectedShapes[mcpToolName.repairToolInput]
        );
      }

      const hasBuiltInSchema = parsed.data.schemaName !== undefined;
      const hasSchemaDescriptor = parsed.data.schemaDescriptor !== undefined;
      if (hasBuiltInSchema === hasSchemaDescriptor) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.repairToolInput,
          [
            {
              code: "invalid_value",
              path: ["schemaName"],
              message: "Provide exactly one of schemaName or schemaDescriptor."
            }
          ],
          expectedShapes[mcpToolName.repairToolInput]
        );
      }

      if (parsed.data.schemaDescriptor) {
        const buildResult = buildRepairSchemaSpecFromDescriptor(parsed.data.schemaDescriptor);
        if (!buildResult.valid) {
          return invalidToolInput(
            deps.telemetry,
            mcpToolName.repairToolInput,
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
            toolName: mcpToolName.repairToolInput
          }
        );

        return asJsonText(toRepairToolResponse(repairResult), !repairResult.valid);
      }

      const schemaName = parsed.data.schemaName;
      if (schemaName === undefined) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.repairToolInput,
          [
            {
              code: "invalid_value",
              path: ["schemaName"],
              message: "schemaName is required when schemaDescriptor is not provided."
            }
          ],
          expectedShapes[mcpToolName.repairToolInput]
        );
      }

      const repairResult = repairToolInput(
        parsed.data.modelId,
        schemaName,
        parsed.data.input,
        {
          sessionId: parsed.data.sessionId,
          telemetry: deps.telemetry,
          toolName: mcpToolName.repairToolInput
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
          toolName: mcpToolName.repairToolInput
        }
      );

      return asJsonText(toRepairToolResponse(repairResult, normalizationResult));
    }
  );

  server.registerTool(
    mcpToolName.compactContext,
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
          deps.telemetry,
          mcpToolName.compactContext,
          parsed.error.issues,
          expectedShapes[mcpToolName.compactContext]
        );
      }

      return asJsonText(compactContext(parsed.data, deps.telemetry));
    }
  );

  server.registerTool(
    mcpToolName.getModelPolicy,
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
          deps.telemetry,
          mcpToolName.getModelPolicy,
          parsed.error.issues,
          expectedShapes[mcpToolName.getModelPolicy]
        );
      }

      return asJsonText(
        parsed.data.modelId ? loadModelPolicy(parsed.data.modelId) : loadAllModelPolicies()
      );
    }
  );

  server.registerTool(
    mcpToolName.inspectModelPolicies,
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
          deps.telemetry,
          mcpToolName.inspectModelPolicies,
          parsed.error.issues,
          expectedShapes[mcpToolName.inspectModelPolicies]
        );
      }

      const modelId = parsed.data.modelId;
      if (modelId !== undefined && !isCanonicalModelId(modelId)) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.inspectModelPolicies,
          [
            {
              code: "invalid_value",
              path: ["modelId"],
              message: `Unknown modelId ${modelId}. Expected one of: ${canonicalModelIds.join(", ")}.`
            }
          ],
          expectedShapes[mcpToolName.inspectModelPolicies]
        );
      }

      const policies =
        modelId === undefined ? loadAllModelPolicies() : [loadModelPolicy(modelId)];

      return asJsonText(inspectModelPolicies(policies, parsed.data));
    }
  );

  server.registerTool(
    mcpToolName.runPolicyDoctor,
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
          mcpToolName.runPolicyDoctor,
          parsed.error.issues,
          expectedShapes[mcpToolName.runPolicyDoctor]
        );
      }

      const modelId = parsed.data.modelId;
      if (modelId !== undefined && !isCanonicalModelId(modelId)) {
        return invalidToolInputWithoutTelemetry(
          mcpToolName.runPolicyDoctor,
          [
            {
              code: "invalid_value",
              path: ["modelId"],
              message: `Unknown modelId ${modelId}. Expected one of: ${canonicalModelIds.join(", ")}.`
            }
          ],
          expectedShapes[mcpToolName.runPolicyDoctor]
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
    mcpToolName.recordEvalEvent,
    {
      title: "Record Eval Event",
      description: "Record a harness evaluation event in telemetry.",
      inputSchema: recordEvalEventInputSchema.shape
    },
    async (input) => {
      const parsed = recordEvalEventInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.recordEvalEvent,
          parsed.error.issues,
          expectedShapes[mcpToolName.recordEvalEvent]
        );
      }

      deps.telemetry.record({
        type: telemetryEvent.evalEventRecorded,
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
    mcpToolName.queryTelemetry,
    {
      title: "Query Telemetry",
      description: "Query in-memory harness telemetry with bounded, redacted metadata.",
      inputSchema: queryTelemetryInputSchema.shape
    },
    async (input) => {
      const parsed = queryTelemetryInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.queryTelemetry,
          parsed.error.issues,
          expectedShapes[mcpToolName.queryTelemetry]
        );
      }

      return asJsonText(queryTelemetry(deps.telemetry, parsed.data));
    }
  );

  server.registerTool(
    mcpToolName.getHarnessStats,
    {
      title: "Get Harness Stats",
      description: "Summarize recent sanitized in-memory harness telemetry.",
      inputSchema: getHarnessStatsInputSchema.shape
    },
    async (input) => {
      const parsed = getHarnessStatsInputSchema.safeParse(input);
      if (!parsed.success) {
        return invalidToolInput(
          deps.telemetry,
          mcpToolName.getHarnessStats,
          parsed.error.issues,
          expectedShapes[mcpToolName.getHarnessStats]
        );
      }

      return asPreSanitizedJsonText(getHarnessStats(deps.telemetry, parsed.data));
    }
  );

  server.registerTool(
    mcpToolName.suggestRepairPolicy,
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
          deps.telemetry,
          mcpToolName.suggestRepairPolicy,
          parsed.error.issues,
          expectedShapes[mcpToolName.suggestRepairPolicy]
        );
      }

      const telemetryWindow = queryTelemetry(deps.telemetry, {
        type: telemetryEvent.toolInputRepaired,
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

function tryLoadPolicyRepairOrder(modelId: string): string[] | undefined {
  try {
    return loadModelPolicy(modelId as never).repairs;
  } catch {
    return undefined;
  }
}

function isCanonicalModelId(value: string): value is CanonicalModelId {
  return (canonicalModelIds as readonly string[]).includes(value);
}
