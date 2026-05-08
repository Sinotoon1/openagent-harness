import "./helpers/setup.js";
import { describe, expect, it } from "vitest";
import { makeRegisteredTools, parseToolResult } from "./helpers/tools.js";
import { callerPathBatchDescriptor, descriptorWithField } from "./helpers/schemaDescriptors.js";

describe("MCP tools", () => {
  it("does not echo raw secrets or raw payload fields from repair_tool_input", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaName: "writeFile",
      input: {
        pathString: "src/a.ts",
        content: "password=raw-password-value\napiKey=raw-api-key-value",
        metadata: {
          apiKey: "raw-api-key-value",
          nested: {
            token: "raw-token-value"
          }
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      normalized: boolean;
      sanitizedOutputPreview: Record<string, unknown>;
      repairedInput?: unknown;
      normalizedInput?: unknown;
      data?: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.normalized).toBe(false);
    expect(body).not.toHaveProperty("data");
    expect(body).not.toHaveProperty("repairedInput");
    expect(body).not.toHaveProperty("normalizedInput");
    expect(body.sanitizedOutputPreview.content).toMatch(/^<omitted:content:/);
    expect(rawText).not.toContain("raw-password-value");
    expect(rawText).not.toContain("raw-api-key-value");
    expect(rawText).not.toContain("raw-token-value");
  });

  it("repairs caller-provided schema bare strings to arrays", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: "src/a.ts"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      schemaName: string;
      repairsApplied: string[];
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(true);
    expect(body.schemaName).toBe("callerPathBatch");
    expect(body.repairsApplied).toContain("bareStringToArray");
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts"]);
  });

  it("parses caller-provided JSON array strings before wrapping bare strings", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: "[\"src/a.ts\",\"src/b.ts\"]"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repairsApplied: string[];
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.repairsApplied).toContain("parseJsonArrayString");
    expect(body.repairsApplied).not.toContain("bareStringToArray");
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("unwraps caller-provided pathStringFields markdown auto-links", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "callerRead",
        schema: {
          type: "object",
          properties: {
            path: { type: "string" },
            reason: { type: "string", optional: true }
          },
          required: ["path"]
        },
        pathStringFields: ["path"]
      },
      input: {
        path: "[src/a.ts](src/a.ts)",
        reason: "[keep-me](keep-me)"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: { path?: string; reason?: string };
    };

    expect(body.valid).toBe(true);
    expect(body.sanitizedOutputPreview.path).toBe("src/a.ts");
    expect(body.sanitizedOutputPreview.reason).toBe("[keep-me](keep-me)");
  });

  it("unwraps caller-provided pathStringArrayFields markdown auto-links inside arrays", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input: {
        paths: ["[src/a.ts](src/a.ts)", "<src/b.ts>"]
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: { paths?: string[] };
      repairsApplied: string[];
    };

    expect(body.valid).toBe(true);
    expect(body.repairsApplied).toEqual(["markdownPathAutolinkUnwrap"]);
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not modify valid caller-provided schema input", async () => {
    const { handlers } = makeRegisteredTools();
    const input = {
      paths: ["src/a.ts"],
      label: "keep"
    };
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: callerPathBatchDescriptor(),
      input
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      repairsApplied: string[];
      notes: unknown[];
      sanitizedOutputPreview: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.repairsApplied).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.sanitizedOutputPreview).toEqual(input);
  });

  it("keeps built-in repair schemas working unchanged", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaName: "pathBatch",
      input: {
        paths: "src/a.ts"
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      schemaName: string;
      repaired: boolean;
      sanitizedOutputPreview: { paths?: string[] };
    };

    expect(body.valid).toBe(true);
    expect(body.schemaName).toBe("pathBatch");
    expect(body.repaired).toBe(true);
    expect(body.sanitizedOutputPreview.paths).toEqual(["src/a.ts"]);
  });

  it("returns structured issues and modelMessage for invalid caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "badDescriptor",
        schema: { type: "string" }
      },
      input: "anything"
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ path: string }>;
      error: { toolName: string; modelMessage: string };
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(body.issues.some((issue) => issue.path === "schemaDescriptor.schema.type")).toBe(true);
    expect(body.error.toolName).toBe("repair_tool_input");
    expect(body.error.modelMessage).toBe(body.modelMessage);
  });

  it("rejects __proto__ fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("__proto__"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(body.issues.some((issue) => issue.message.includes("__proto__"))).toBe(true);
  });

  it("rejects prototype fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("prototype"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("prototype"))).toBe(true);
  });

  it("rejects constructor fields in caller descriptors", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("constructor"),
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("constructor"))).toBe(true);
  });

  it("rejects dangerous keys in caller pathStringFields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "dangerousPath",
        schema: {
          type: "object",
          properties: {
            safe: { type: "string" }
          }
        },
        pathStringFields: ["__proto__"]
      },
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("__proto__"))).toBe(true);
  });

  it("rejects dangerous keys in caller pathStringArrayFields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "dangerousArrayPath",
        schema: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        pathStringArrayFields: ["constructor"]
      },
      input: {}
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      issues: Array<{ message: string }>;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.issues.some((issue) => issue.message.includes("constructor"))).toBe(true);
  });

  it("allows normal nested safe caller descriptor fields", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "safeNested",
        schema: {
          type: "object",
          properties: {
            config: {
              type: "object",
              properties: {
                value: { type: "string" }
              }
            }
          }
        }
      },
      input: {
        config: {
          value: "ok"
        }
      }
    });

    const body = parseToolResult(result!) as {
      valid: boolean;
      repaired: boolean;
      sanitizedOutputPreview: unknown;
    };

    expect(body.valid).toBe(true);
    expect(body.repaired).toBe(false);
    expect(body.sanitizedOutputPreview).toEqual({
      config: {
        value: "ok"
      }
    });
  });

  it("rejects oversized and deep caller descriptors safely", async () => {
    const { handlers } = makeRegisteredTools();
    const properties = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [`field${index}`, { type: "string" }])
    );
    const oversized = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "tooManyFields",
        schema: {
          type: "object",
          properties
        }
      },
      input: {}
    });
    const deep = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "tooDeep",
        schema: {
          type: "object",
          properties: {
            a: {
              type: "object",
              properties: {
                b: {
                  type: "object",
                  properties: {
                    c: {
                      type: "object",
                      properties: {
                        d: {
                          type: "object",
                          properties: {
                            e: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      input: {}
    });

    const oversizedBody = parseToolResult(oversized!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };
    const deepBody = parseToolResult(deep!) as {
      valid: boolean;
      modelMessage: string;
      issues: Array<{ message: string }>;
    };

    expect(oversized?.isError).toBe(true);
    expect(deep?.isError).toBe(true);
    expect(oversizedBody.valid).toBe(false);
    expect(deepBody.valid).toBe(false);
    expect(oversizedBody.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(deepBody.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(oversizedBody.issues.some((issue) => issue.message.includes("maximum is 50"))).toBe(
      true
    );
    expect(deepBody.issues.some((issue) => issue.message.includes("maximum is 5"))).toBe(true);
  });

  it("does not leak raw secrets or file content from caller-provided repair responses", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: {
        toolName: "callerWrite",
        schema: {
          type: "object",
          properties: {
            content: { type: "string" },
            metadata: {
              type: "object",
              properties: {
                apiKey: { type: "string" },
                fileContent: { type: "string" }
              }
            }
          }
        }
      },
      input: {
        content: "password=raw-password-value\nsuper secret file body",
        metadata: {
          apiKey: "raw-api-key-value",
          fileContent: "raw-file-content-value"
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      sanitizedOutputPreview: {
        content?: string;
        metadata?: Record<string, unknown>;
      };
    };

    expect(body.valid).toBe(true);
    expect(body.sanitizedOutputPreview.content).toMatch(/^<omitted:content:/);
    expect(body.sanitizedOutputPreview.metadata?.apiKey).toBe("<redacted>");
    expect(body.sanitizedOutputPreview.metadata?.fileContent).toMatch(/^<omitted:filecontent:/);
    expect(rawText).not.toContain("raw-password-value");
    expect(rawText).not.toContain("super secret file body");
    expect(rawText).not.toContain("raw-api-key-value");
    expect(rawText).not.toContain("raw-file-content-value");
  });

  it("does not leak raw secrets in invalid caller descriptor responses", async () => {
    const { handlers } = makeRegisteredTools();
    const result = await handlers.get("repair_tool_input")?.({
      modelId: "deepseek-v4-pro",
      schemaDescriptor: descriptorWithField("constructor"),
      input: {
        content: "password=raw-invalid-descriptor-password",
        metadata: {
          apiKey: "raw-invalid-descriptor-api-key"
        }
      }
    });

    const rawText = result?.content[0]?.text ?? "";
    const body = parseToolResult(result!) as {
      valid: boolean;
      modelMessage: string;
    };

    expect(result?.isError).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.modelMessage).toContain("Tool repair_tool_input input is invalid.");
    expect(rawText).not.toContain("raw-invalid-descriptor-password");
    expect(rawText).not.toContain("raw-invalid-descriptor-api-key");
  });

});
