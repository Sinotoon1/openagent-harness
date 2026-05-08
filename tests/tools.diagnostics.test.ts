import "./helpers/setup.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JsonlTelemetrySink } from "../src/telemetry/jsonl.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import { makeRegisteredTools, parseToolResult } from "./helpers/tools.js";
import { tempTelemetryPath } from "./helpers/tempFiles.js";

describe("MCP tools", () => {
  it("registers run_policy_doctor", () => {
    const { handlers } = makeRegisteredTools();

    expect(handlers.has("run_policy_doctor")).toBe(true);
  });

  it("returns a structured invalid response for unknown run_policy_doctor modelId", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
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
    expect(body.modelMessage).toContain("Tool run_policy_doctor input is invalid.");
    expect(body.issues[0]?.path).toBe("modelId");
    expect(body.issues[0]?.message).toContain("Unknown modelId not-a-model.");
    expect(body.error.toolName).toBe("run_policy_doctor");
    expect(body.error.modelMessage).toBe(body.modelMessage);
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("returns a structured invalid response without telemetry for invalid run_policy_doctor schema input", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeTelemetry: "yes"
    });
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string; message: string }>;
      error: { code: string; toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool run_policy_doctor input is invalid.");
    expect(body.issues[0]?.path).toBe("includeTelemetry");
    expect(body.error.code).toBe("tool_input_invalid");
    expect(body.error.toolName).toBe("run_policy_doctor");
    expect(body.error.modelMessage).toBe(body.modelMessage);
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("does not append JSONL telemetry for invalid run_policy_doctor schema input", async () => {
    const telemetryPath = tempTelemetryPath();
    const telemetry = new JsonlTelemetrySink(telemetryPath);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeProviderConfig: "no"
    });

    expect(result?.isError).toBe(true);
    expect(readFileSync(telemetryPath, "utf8")).toBe("");
  });

  it("does not append JSONL telemetry for unknown run_policy_doctor modelId", async () => {
    const telemetryPath = tempTelemetryPath();
    const telemetry = new JsonlTelemetrySink(telemetryPath);
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      modelId: "not-a-model"
    });

    expect(result?.isError).toBe(true);
    expect(readFileSync(telemetryPath, "utf8")).toBe("");
  });

  it("does not record telemetry for valid run_policy_doctor input", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("run_policy_doctor")?.({
      includeTelemetry: false,
      includeProviderConfig: false
    });

    expect(result?.isError).toBeFalsy();
    expect(telemetry.getEvents()).toHaveLength(0);
  });

  it("returns standardized invalid responses with modelMessage", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);
    const result = await handlers.get("get_model_policy")?.({ modelId: "not-a-model" });

    expect(result?.isError).toBe(true);
    const body = parseToolResult(result!);

    expect(body).toMatchObject({
      valid: false,
      error: {
        code: "tool_input_invalid",
        toolName: "get_model_policy"
      }
    });
    expect((body as { modelMessage: string }).modelMessage).toContain(
      "Tool get_model_policy input is invalid."
    );
    expect((body as { issues: unknown[] }).issues).toHaveLength(1);
    expect(telemetry.getEvents()).toEqual([
      expect.objectContaining({
        type: "tool_input_invalid",
        toolName: "get_model_policy"
      })
    ]);
  });

  it("rejects the old deepseek-flash model ID", async () => {
    const telemetry = new InMemoryTelemetrySink();
    const { handlers } = makeRegisteredTools(telemetry);

    const result = await handlers.get("get_model_policy")?.({ modelId: "deepseek-flash" });
    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ path: string; message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues[0]?.path).toBe("modelId");
    expect(JSON.stringify(body)).toContain("deepseek-v4-flash");
  });
});
