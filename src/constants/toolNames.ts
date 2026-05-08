export const mcpToolName = {
  ossChat: "oss_chat",
  repairToolInput: "repair_tool_input",
  compactContext: "compact_context",
  getModelPolicy: "get_model_policy",
  recordEvalEvent: "record_eval_event",
  queryTelemetry: "query_telemetry",
  getHarnessStats: "get_harness_stats",
  suggestRepairPolicy: "suggest_repair_policy",
  inspectModelPolicies: "inspect_model_policies",
  runPolicyDoctor: "run_policy_doctor"
} as const;

export const mcpToolNames = [
  mcpToolName.ossChat,
  mcpToolName.repairToolInput,
  mcpToolName.compactContext,
  mcpToolName.getModelPolicy,
  mcpToolName.recordEvalEvent,
  mcpToolName.queryTelemetry,
  mcpToolName.getHarnessStats,
  mcpToolName.suggestRepairPolicy,
  mcpToolName.inspectModelPolicies,
  mcpToolName.runPolicyDoctor
] as const;

export type McpToolName = (typeof mcpToolNames)[number];
