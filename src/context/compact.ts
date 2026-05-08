import type { CanonicalModelId, ChatMessage, Note } from "../types.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { loadModelPolicy } from "../policies/loader.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";

export interface CompactContextInput {
  modelId: CanonicalModelId;
  sessionId?: string;
  messages: ChatMessage[];
  usedTokens?: number;
  inFlightTaskMessageIds?: string[];
}

export interface CompactContextOutput {
  modelId: CanonicalModelId;
  effectiveContextTokens: number;
  usedTokens: number;
  pressure: number;
  strategy: "none" | "drop_dead_tool_calls" | "aggressive_drop" | "summarize_old_context";
  messages: ChatMessage[];
  notes: Note[];
}

export function compactContext(
  input: CompactContextInput,
  telemetry?: TelemetrySink
): CompactContextOutput {
  const policy = loadModelPolicy(input.modelId);
  const usedTokens = input.usedTokens ?? estimateTokens(input.messages);
  const pressure = usedTokens / policy.effectiveContextTokens;
  const inFlightIds = new Set(input.inFlightTaskMessageIds ?? []);
  const isInFlight = (message: ChatMessage) =>
    message.status === "in_flight" || (message.id !== undefined && inFlightIds.has(message.id));

  if (pressure < 0.5) {
    return {
      modelId: input.modelId,
      effectiveContextTokens: policy.effectiveContextTokens,
      usedTokens,
      pressure,
      strategy: "none",
      messages: input.messages,
      notes: []
    };
  }

  let messages: ChatMessage[];
  let strategy: CompactContextOutput["strategy"];
  const notes: Note[] = [];

  if (pressure >= 0.9) {
    strategy = "summarize_old_context";
    messages = summarizeOldContext(input.messages, isInFlight);
    notes.push({
      code: "context.summarizedOldContext",
      message:
        "Context pressure reached 90%; summarized old context while preserving the in-flight task."
    });
  } else if (pressure >= 0.8) {
    strategy = "aggressive_drop";
    messages = aggressivelyDrop(input.messages, isInFlight);
    notes.push({
      code: "context.aggressiveDrop",
      message:
        "Context pressure reached 80%; dropped dead tool calls and older non-critical context."
    });
  } else {
    strategy = "drop_dead_tool_calls";
    messages = dropOldDeadToolCalls(input.messages, isInFlight);
    notes.push({
      code: "context.droppedDeadToolCalls",
      message: "Context pressure reached 50%; dropped old dead tool calls."
    });
  }

  telemetry?.record({
    type: telemetryEvent.contextCompacted,
    sessionId: input.sessionId,
    modelId: input.modelId,
    metadata: {
      strategy,
      beforeMessages: input.messages.length,
      afterMessages: messages.length,
      pressure
    }
  });

  return {
    modelId: input.modelId,
    effectiveContextTokens: policy.effectiveContextTokens,
    usedTokens,
    pressure,
    strategy,
    messages,
    notes
  };
}

function dropOldDeadToolCalls(
  messages: ChatMessage[],
  isInFlight: (message: ChatMessage) => boolean
): ChatMessage[] {
  return messages.filter((message) => {
    if (isInFlight(message)) {
      return true;
    }

    return !(message.role === "tool" && message.status === "dead");
  });
}

function aggressivelyDrop(
  messages: ChatMessage[],
  isInFlight: (message: ChatMessage) => boolean
): ChatMessage[] {
  const protectedMessages = messages.filter(isInFlight);
  const systemMessages = messages.filter((message) => message.role === "system");
  const recentMessages = messages.slice(-20).filter((message) => {
    if (isInFlight(message)) {
      return false;
    }

    return !(message.role === "tool" && message.status === "dead");
  });

  return dedupeByIdOrReference([...systemMessages, ...recentMessages, ...protectedMessages]);
}

function summarizeOldContext(
  messages: ChatMessage[],
  isInFlight: (message: ChatMessage) => boolean
): ChatMessage[] {
  const protectedMessages = messages.filter(isInFlight);
  const systemMessages = messages.filter((message) => message.role === "system");
  const recentMessages = messages.slice(-12).filter((message) => !isInFlight(message));
  const oldMessages = messages.filter(
    (message) =>
      !isInFlight(message) && !systemMessages.includes(message) && !recentMessages.includes(message)
  );

  const summary = summarizeMessages(oldMessages);
  const syntheticSummary: ChatMessage[] = summary
    ? [
        {
          role: "assistant",
          content: summary,
          id: "compacted-old-context-summary",
          status: "live"
        }
      ]
    : [];

  return dedupeByIdOrReference([
    ...systemMessages,
    ...syntheticSummary,
    ...recentMessages,
    ...protectedMessages
  ]);
}

function summarizeMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  const roleCounts = messages.reduce<Record<string, number>>((counts, message) => {
    counts[message.role] = (counts[message.role] ?? 0) + 1;
    return counts;
  }, {});
  const sampled = messages
    .slice(0, 8)
    .map((message) => `${message.role}: ${message.content.replace(/\s+/g, " ").slice(0, 140)}`)
    .join("\n");

  return [
    "Compacted summary of older context:",
    `Messages summarized: ${messages.length}.`,
    `Role counts: ${Object.entries(roleCounts)
      .map(([role, count]) => `${role}=${count}`)
      .join(", ")}.`,
    sampled
  ].join("\n");
}

function dedupeByIdOrReference(messages: ChatMessage[]): ChatMessage[] {
  const seenIds = new Set<string>();
  const seenObjects = new Set<ChatMessage>();
  const output: ChatMessage[] = [];

  for (const message of messages) {
    if (message.id) {
      if (seenIds.has(message.id)) {
        continue;
      }
      seenIds.add(message.id);
    } else if (seenObjects.has(message)) {
      continue;
    }

    seenObjects.add(message);
    output.push(message);
  }

  return output;
}

function estimateTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + Math.ceil(message.content.length / 4), 0);
}
