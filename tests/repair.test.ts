import { describe, expect, it } from "vitest";
import { repairToolInput } from "../src/repair/engine.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import { normalizeToolInput } from "../src/tools/normalizeToolInput.js";

describe("repairToolInput", () => {
  it("strips null optional fields when the model policy allows it", () => {
    const result = repairToolInput("kimi-k2-6", "pathBatch", {
      paths: [],
      optionalPaths: null
    });

    expect(result.valid).toBe(true);
    expect(result.repairedInput).toEqual({ paths: [] });
    expect(result.notes.map((note) => note.code)).toContain("repair.stripNullOptional");
  });

  it("does not strip null optional fields when the model policy does not allow it", () => {
    const result = repairToolInput("deepseek-flash", "pathBatch", {
      paths: [],
      optionalPaths: null
    });

    expect(result.valid).toBe(false);
  });

  it("parses JSON array strings before wrapping bare strings", () => {
    const result = repairToolInput("deepseek-v4-pro", "pathBatch", {
      paths: "[\"src/a.ts\",\"src/b.ts\"]"
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ paths: ["src/a.ts", "src/b.ts"] });
    expect(result.notes.map((note) => note.code)).toContain("repair.parseJsonArrayString");
    expect(result.notes.map((note) => note.code)).not.toContain("repair.bareStringToArray");
  });

  it("converts empty object placeholders to empty arrays", () => {
    const result = repairToolInput("kimi-k2-6", "pathBatch", {
      paths: {}
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ paths: [] });
    expect(result.notes.map((note) => note.code)).toContain("repair.emptyObjectToArray");
  });

  it("wraps bare strings as one-item arrays", () => {
    const result = repairToolInput("deepseek-v4-pro", "pathBatch", {
      paths: "src/a.ts"
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ paths: ["src/a.ts"] });
    expect(result.notes.map((note) => note.code)).toContain("repair.bareStringToArray");
  });

  it("unwraps degenerate markdown auto-links in pathString fields only", () => {
    const result = repairToolInput("deepseek-v4-pro", "readFile", {
      pathString: "[src/a.ts](src/a.ts)",
      reason: "[keep-me](keep-me)"
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      pathString: "src/a.ts",
      reason: "[keep-me](keep-me)"
    });
  });

  it("returns immediately for valid input without repair or normalization", () => {
    const result = repairToolInput("deepseek-v4-pro", "readFile", {
      pathString: "src/a.ts",
      limit: 50
    });

    expect(result.valid).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.data).toEqual({ pathString: "src/a.ts", limit: 50 });
    expect(result.notes).toEqual([]);
  });

  it("applies readFile relational defaults through normalization notes", () => {
    const telemetry = new InMemoryTelemetrySink();
    const limitOnly = normalizeToolInput(
      "readFile",
      {
        pathString: "src/a.ts",
        limit: 50
      },
      { telemetry, modelId: "deepseek-v4-pro", sessionId: "s1" }
    );
    const offsetOnly = repairToolInput("deepseek-v4-pro", "readFile", {
      pathString: "src/a.ts",
      offset: 10
    });
    const normalizedOffsetOnly = normalizeToolInput("readFile", offsetOnly.data);

    expect(limitOnly.valid).toBe(true);
    expect(limitOnly.normalized).toBe(true);
    expect(limitOnly.data).toEqual({ pathString: "src/a.ts", limit: 50, offset: 0 });
    expect(limitOnly.notes[0]?.code).toBe("readFile.offsetDefaulted");
    expect(normalizedOffsetOnly.valid).toBe(true);
    expect(normalizedOffsetOnly.normalized).toBe(true);
    expect(normalizedOffsetOnly.data).toEqual({
      pathString: "src/a.ts",
      offset: 10,
      limit: 2000
    });
    expect(normalizedOffsetOnly.notes[0]?.code).toBe("readFile.limitDefaulted");
    expect(telemetry.events.map((event) => event.type)).toEqual(["tool_input_normalized"]);
  });

  it("does not modify writeFile.content when repairing another issue path", () => {
    const result = repairToolInput("deepseek-v4-pro", "writeFile", {
      pathString: "src/a.ts",
      content: "[src/a.ts](src/a.ts)",
      metadata: null
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      pathString: "src/a.ts",
      content: "[src/a.ts](src/a.ts)"
    });
    expect(result.notes.map((note) => note.path)).toEqual(["metadata"]);
  });

  it("does not modify non-issue fields while repairing an issue path", () => {
    const result = repairToolInput("deepseek-v4-pro", "pathBatch", {
      paths: "src/a.ts",
      label: "[keep-me](keep-me)"
    });

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({
      paths: ["src/a.ts"],
      label: "[keep-me](keep-me)"
    });
    expect(result.notes.map((note) => note.path)).toEqual(["paths"]);
  });

  it("returns a concise model-readable message when repair cannot make input valid", () => {
    const result = repairToolInput("deepseek-flash", "pathBatch", {
      paths: [],
      optionalPaths: null
    });

    expect(result.valid).toBe(false);
    expect(result.modelMessage).toContain("Tool pathBatch input is invalid.");
    expect(result.modelMessage).toContain("Invalid fields: optionalPaths");
    expect(result.modelMessage).toContain("Expected shape:");
    expect(result.modelMessage).toContain("Retry this tool call");
  });

  it("records invalid and repaired telemetry events", () => {
    const telemetry = new InMemoryTelemetrySink();
    const result = repairToolInput(
      "deepseek-v4-pro",
      "pathBatch",
      { paths: "src/a.ts" },
      { telemetry, sessionId: "s1", toolName: "repair_tool_input" }
    );

    expect(result.valid).toBe(true);
    expect(telemetry.events.map((event) => event.type)).toEqual([
      "tool_input_invalid",
      "tool_input_repaired"
    ]);
  });
});
