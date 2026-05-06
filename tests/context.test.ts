import { describe, expect, it } from "vitest";
import { compactContext } from "../src/context/compact.js";
import { InMemoryTelemetrySink } from "../src/telemetry/memory.js";
import type { ChatMessage } from "../src/types.js";

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 5 === 0 ? "tool" : "user",
    status: index % 5 === 0 ? "dead" : "live",
    content: `message ${index}`
  }));
}

describe("compactContext", () => {
  it("uses effective context tokens and drops old dead tool calls at 50%", () => {
    const telemetry = new InMemoryTelemetrySink();
    const messages = makeMessages(10);
    const result = compactContext(
      {
        modelId: "kimi-k2-6",
        sessionId: "s1",
        messages,
        usedTokens: 48_000
      },
      telemetry
    );

    expect(result.effectiveContextTokens).toBe(96_000);
    expect(result.strategy).toBe("drop_dead_tool_calls");
    expect(result.messages.some((message) => message.role === "tool")).toBe(false);
    expect(telemetry.events[0]?.type).toBe("context_compacted");
  });

  it("preserves in-flight messages when summarizing old context at 90%", () => {
    const messages = [
      ...makeMessages(30),
      { id: "flight", role: "assistant" as const, status: "in_flight" as const, content: "doing it" }
    ];

    const result = compactContext({
      modelId: "deepseek-v4-pro",
      messages,
      usedTokens: 95_000,
      inFlightTaskMessageIds: ["flight"]
    });

    expect(result.strategy).toBe("summarize_old_context");
    expect(result.messages.some((message) => message.id === "flight")).toBe(true);
    expect(result.messages.some((message) => message.id === "compacted-old-context-summary")).toBe(
      true
    );
  });
});
