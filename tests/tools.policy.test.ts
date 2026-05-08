import "./helpers/setup.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import { createReviewableRepairPolicySuggestions } from "../src/telemetry/repairPolicySuggestions.js";
import { expectTextNotToContainAny } from "./helpers/assertions.js";
import { makeRegisteredTools, parseToolResult } from "./helpers/tools.js";
import { confidenceFor, recordRepairEvents } from "./helpers/telemetry.js";

describe("MCP tools", () => {
  it("registers inspect_model_policies", () => {
    const { handlers } = makeRegisteredTools();

    expect(handlers.has("inspect_model_policies")).toBe(true);
  });

  it("lists all model policies through inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({}))!
    ) as {
      models: Array<{
        modelId: string;
        repairs: string[];
        context: { effectiveContextTokens: number };
        providerOverrides: unknown[];
        warnings: unknown[];
        valid: boolean;
      }>;
    };

    expect(body.models.map((model) => model.modelId)).toEqual([
      "kimi-k2-6",
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ]);
    expect(body.models.every((model) => model.valid)).toBe(true);
  });

  it("filters inspect_model_policies by modelId", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({ modelId: "deepseek-v4-pro" }))!
    ) as { models: Array<{ modelId: string }> };

    expect(body.models.map((model) => model.modelId)).toEqual(["deepseek-v4-pro"]);
  });

  it("shows the DeepSeek provider override from YAML in inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      models: Array<{
        providerOverrides: Array<{
          providerId: string;
          thinking: string;
          reason: string;
        }>;
      }>;
    };

    expect(body.models[0]?.providerOverrides).toEqual([
      {
        providerId: "deepseekPrimary",
        thinking: "disabled",
        reason: "deepseek-v4-pro on deepseekPrimary must run with thinking disabled"
      }
    ]);
  });

  it("hides repairs when inspect_model_policies includeRepairs is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeRepairs: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("repairs");
    expect(body.models[0]).toHaveProperty("context");
  });

  it("hides context when inspect_model_policies includeContext is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeContext: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("context");
    expect(body.models[0]).toHaveProperty("repairs");
  });

  it("hides providerOverrides when inspect_model_policies includeOverrides is false", async () => {
    const { handlers } = makeRegisteredTools();

    const body = parseToolResult(
      (await handlers.get("inspect_model_policies")?.({
        modelId: "deepseek-v4-pro",
        includeOverrides: false
      }))!
    ) as { models: Array<Record<string, unknown>> };

    expect(body.models[0]).not.toHaveProperty("providerOverrides");
    expect(body.models[0]).toHaveProperty("warnings");
  });

  it("returns a structured invalid response for unknown inspect_model_policies modelId", async () => {
    const { handlers } = makeRegisteredTools();

    const result = await handlers.get("inspect_model_policies")?.({
      modelId: "not-a-model"
    });
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string; message: string }>;
      error: { toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool inspect_model_policies input is invalid.");
    expect(body.issues[0]?.path).toBe("modelId");
    expect(body.issues[0]?.message).toContain("Unknown modelId not-a-model.");
    expect(body.error.toolName).toBe("inspect_model_policies");
    expect(body.error.modelMessage).toBe(body.modelMessage);
  });

  it("does not expose provider credentials through inspect_model_policies", async () => {
    const { handlers } = makeRegisteredTools();

    const response =
      (await handlers.get("inspect_model_policies")?.({ includeWarnings: true }))?.content[0]
        ?.text ?? "";

    expect(response).not.toContain("DEEPSEEK_PRIMARY_API_KEY");
    expect(response).not.toContain("OPENROUTER_FALLBACK_API_KEY");
    expect(response).not.toContain("YOUR_KEY");
    expect(response).not.toContain("sk-");
  });


  it("suggests repair-policy order from MCP telemetry without editing policies", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      modelId: "deepseek-v4-pro",
      metadata: {
        repairs: ["bareStringToArray", "bareStringToArray", "parseJsonArrayString"]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      suggestions: Array<{
        modelId: string;
        suggestedRepairOrder: string[];
        currentPolicyOrder: string[];
      }>;
      policySuggestions: Array<{ modelId: string; kind: string }>;
      note: string;
    };

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.modelId).toBe("deepseek-v4-pro");
    expect(result.suggestions[0]?.suggestedRepairOrder[0]).toBe("bareStringToArray");
    expect(result.suggestions[0]?.currentPolicyOrder).toContain("parseJsonArrayString");
    expect(result.policySuggestions[0]).toMatchObject({
      modelId: "deepseek-v4-pro",
      kind: "repair_order"
    });
    expect(result.note).toBe("No YAML policies were modified.");
  });

  it("returns an explicit insufficient_data row for requested models with zero repair telemetry", async () => {
    const { handlers } = makeRegisteredTools();

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-flash" }))!
    ) as {
      suggestions: unknown[];
      policySuggestions: Array<{
        modelId: string;
        kind: string;
        status: string;
        confidence: string;
        window: { type: string; limit: number; eventCount: number };
        currentRepairs?: string[];
        suggestedRepairs: string[];
        warnings: Array<{ code: string; message: string }>;
        reason: string;
        yamlPatchPreview: string | null;
      }>;
    };
    const suggestion = result.policySuggestions[0];

    expect(result.suggestions).toEqual([]);
    expect(result.policySuggestions).toHaveLength(1);
    expect(suggestion).toMatchObject({
      modelId: "deepseek-v4-flash",
      kind: "repair_order",
      status: "insufficient_data",
      confidence: "low",
      window: {
        type: "latest",
        limit: 200,
        eventCount: 0
      },
      suggestedRepairs: [],
      yamlPatchPreview: null
    });
    expect(suggestion?.currentRepairs).toEqual([
      "markdownPathAutolinkUnwrap",
      "parseJsonArrayString",
      "bareStringToArray"
    ]);
    expect(suggestion?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "zero_repaired_telemetry_events",
          message:
            "No repaired telemetry events were found for this model in the bounded latest window."
        }),
        expect.objectContaining({ code: "bounded_latest_window" }),
        expect.objectContaining({ code: "telemetry_sink_configured" })
      ])
    );
    expect(suggestion?.reason).toContain("no repair-order change is suggested");
  });

  it("warns instead of crashing when a zero-event model policy is missing", () => {
    const suggestions = createReviewableRepairPolicySuggestions([], {
      modelId: "missing-policy-model",
      limit: 200,
      currentRepairsForModel: () => undefined
    });

    expect(suggestions).toMatchObject([
      {
        modelId: "missing-policy-model",
        status: "insufficient_data",
        confidence: "low",
        window: {
          type: "latest",
          limit: 200,
          eventCount: 0
        },
        suggestedRepairs: [],
        yamlPatchPreview: null
      }
    ]);
    expect(suggestions[0]?.currentRepairs).toBeUndefined();
    expect(suggestions[0]?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "zero_repaired_telemetry_events" }),
        expect.objectContaining({ code: "current_policy_unavailable" }),
        expect.objectContaining({ code: "model_policy_not_found" })
      ])
    );
  });

  it("does not emit zero-event policy suggestions for every model when modelId is omitted", async () => {
    const { handlers } = makeRegisteredTools();

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      suggestions: unknown[];
      policySuggestions: unknown[];
    };

    expect(result.suggestions).toEqual([]);
    expect(result.policySuggestions).toEqual([]);
  });

  it("keeps zero-event suggestion output sanitized", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "raw-zero-suggest-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray"],
        apiKey: "raw-zero-api-key",
        fileContent: "raw-zero-file-content",
        command: "deploy --token raw-zero-command-token",
        headers: {
          authorization: "Bearer raw-zero-authorization"
        },
        env: {
          API_KEY: "raw-zero-env-key"
        },
        stdout: "token=raw-zero-stdout-token",
        stderr: "password=raw-zero-stderr-password",
        messages: [{ role: "user", content: "raw zero prompt content" }]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-flash" }))?.content[0]
        ?.text ?? "";

    expect(response).toContain("insufficient_data");
    expectTextNotToContainAny(response, [
      "raw-zero-suggest-session",
      "raw-zero-api-key",
      "raw-zero-file-content",
      "raw-zero-command-token",
      "raw-zero-authorization",
      "raw-zero-env-key",
      "raw-zero-stdout-token",
      "raw-zero-stderr-password",
      "raw zero prompt content"
    ]);
  });

  it("builds reviewable repair policy suggestions grouped by model and ordered by frequency", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["parseJsonArrayString"], 3);
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray"], 1);
    recordRepairEvents(telemetry, "deepseek-v4-pro", ["stripNullOptional"], 2);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{
        modelId: string;
        confidence: string;
        currentRepairs?: string[];
        suggestedRepairs: string[];
        window: { eventCount: number; limit: number; type: string };
        yamlPatchPreview: string;
      }>;
    };
    const kimi = result.policySuggestions.find((suggestion) => suggestion.modelId === "kimi-k2-6");
    const deepseek = result.policySuggestions.find(
      (suggestion) => suggestion.modelId === "deepseek-v4-pro"
    );

    expect(result.policySuggestions.map((suggestion) => suggestion.modelId).sort()).toEqual([
      "deepseek-v4-pro",
      "kimi-k2-6"
    ]);
    expect(kimi?.suggestedRepairs.slice(0, 2)).toEqual([
      "parseJsonArrayString",
      "bareStringToArray"
    ]);
    expect(kimi?.currentRepairs).toEqual([
      "emptyObjectToArray",
      "parseJsonArrayString",
      "bareStringToArray",
      "stripNullOptional"
    ]);
    expect(kimi?.window).toEqual({ type: "latest", limit: 200, eventCount: 4 });
    expect(kimi?.confidence).toBe("low");
    expect(kimi?.yamlPatchPreview).toContain("repairs:");
    expect(deepseek?.suggestedRepairs[0]).toBe("stripNullOptional");
  });

  it("marks repair policy suggestions as already_aligned when they match current policy", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(
      telemetry,
      "deepseek-v4-pro",
      [
        "parseJsonArrayString",
        "bareStringToArray",
        "stripNullOptional",
        "markdownPathAutolinkUnwrap"
      ],
      1
    );
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "deepseek-v4-pro" }))!
    ) as {
      policySuggestions: Array<{
        status: string;
        warnings: Array<{ code: string }>;
        yamlPatchPreview: string;
      }>;
    };

    expect(result.policySuggestions[0]?.status).toBe("already_aligned");
    expect(result.policySuggestions[0]?.warnings).toContainEqual({
      code: "suggested_order_unchanged",
      message: "Suggested repair order already matches the current model policy."
    });
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("No YAML change is suggested");
  });

  it("assigns low, medium, and high confidence by repaired event count", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "low-confidence-model", ["bareStringToArray"], 9);
    recordRepairEvents(telemetry, "medium-confidence-model", ["bareStringToArray"], 10);
    recordRepairEvents(telemetry, "high-confidence-model", ["bareStringToArray"], 50);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{ modelId: string; confidence: string }>;
    };

    expect(confidenceFor(result.policySuggestions, "low-confidence-model")).toBe("low");
    expect(confidenceFor(result.policySuggestions, "medium-confidence-model")).toBe("medium");
    expect(confidenceFor(result.policySuggestions, "high-confidence-model")).toBe("high");
  });

  it("warns on unknown repair names and excludes them from yamlPatchPreview", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray", "unknownRepairName"], 1);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))!
    ) as {
      policySuggestions: Array<{
        warnings: Array<{ code: string }>;
        yamlPatchPreview: string;
      }>;
    };

    expect(result.policySuggestions[0]?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown_repair_names"
        })
      ])
    );
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("bareStringToArray");
    expect(result.policySuggestions[0]?.yamlPatchPreview).not.toContain("unknownRepairName");
  });

  it("warns when a model policy is missing without crashing", async () => {
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "missing-policy-model", ["bareStringToArray"], 1);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult((await handlers.get("suggest_repair_policy")?.({}))!) as {
      policySuggestions: Array<{
        modelId: string;
        status: string;
        currentRepairs?: string[];
        warnings: Array<{ code: string }>;
      }>;
    };
    const missing = result.policySuggestions.find(
      (suggestion) => suggestion.modelId === "missing-policy-model"
    );

    expect(missing?.status).toBe("policy_not_found");
    expect(missing?.currentRepairs).toBeUndefined();
    expect(missing?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "current_policy_unavailable" }),
        expect.objectContaining({ code: "model_policy_not_found" })
      ])
    );
  });

  it("returns yamlPatchPreview without writing policy files", async () => {
    const policyPath = "src/policies/kimi-k2-6.yaml";
    const before = readFileSync(policyPath, "utf8");
    const telemetry = new InMemoryTelemetrySink();
    recordRepairEvents(telemetry, "kimi-k2-6", ["bareStringToArray"], 2);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = parseToolResult(
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))!
    ) as { policySuggestions: Array<{ yamlPatchPreview: string }> };
    const after = readFileSync(policyPath, "utf8");

    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain(
      "Suggestion only; review manually"
    );
    expect(result.policySuggestions[0]?.yamlPatchPreview).toContain("bareStringToArray");
    expect(after).toBe(before);
  });

  it("does not leak raw sensitive telemetry into repair policy suggestions", async () => {
    const telemetry = new InMemoryTelemetrySink();
    telemetry.record({
      type: "tool_input_repaired",
      sessionId: "raw-suggest-session",
      modelId: "kimi-k2-6",
      toolName: "repair_tool_input",
      metadata: {
        repairs: ["bareStringToArray", "token=raw-repair-token"],
        apiKey: "raw-api-key-value",
        fileContent: "raw-file-content-value",
        command: "deploy --token raw-command-token",
        headers: {
          authorization: "Bearer raw-authorization-value"
        },
        env: {
          API_KEY: "raw-env-key"
        },
        stdout: "token=raw-stdout-token",
        stderr: "password=raw-stderr-password",
        messages: [{ role: "user", content: "raw prompt content" }]
      }
    });
    const { handlers } = makeRegisteredTools(telemetry);

    const response =
      (await handlers.get("suggest_repair_policy")?.({ modelId: "kimi-k2-6" }))?.content[0]
        ?.text ?? "";

    expect(response).toContain("policySuggestions");
    expectTextNotToContainAny(response, [
      "raw-suggest-session",
      "raw-repair-token",
      "raw-api-key-value",
      "raw-file-content-value",
      "raw-command-token",
      "raw-authorization-value",
      "raw-env-key",
      "raw-stdout-token",
      "raw-stderr-password",
      "raw prompt content"
    ]);
  });
});
