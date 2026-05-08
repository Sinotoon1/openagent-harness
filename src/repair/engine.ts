import type { CanonicalModelId, Note } from "../types.js";
import type { TelemetrySink } from "../telemetry/types.js";
import type { RepairName } from "../policies/types.js";
import { loadModelPolicy } from "../policies/loader.js";
import {
  repairExecutionOrder,
  repairName,
  repairNoteCode
} from "../constants/repairNames.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import {
  repairSchemaSpecs,
  type RepairSchemaName,
  type RepairSchemaSpec
} from "./schemaSpecs.js";
import {
  makeInvalidToolResponse,
  pathToString,
  summarizeIssue,
  type StandardInvalidToolResponse
} from "../validation/invalidResponse.js";

type IssuePathSegment = string | number | symbol;

export interface RepairToolInputResult {
  valid: boolean;
  repaired: boolean;
  schemaName: string;
  modelId: CanonicalModelId;
  data?: unknown;
  repairedInput?: unknown;
  notes: Note[];
  issues?: unknown;
  modelMessage?: string;
  error?: StandardInvalidToolResponse["error"];
}

export interface RepairToolInputOptions {
  telemetry?: TelemetrySink;
  sessionId?: string;
  toolName?: string;
}

export function repairToolInput(
  modelId: CanonicalModelId,
  schemaName: RepairSchemaName,
  input: unknown,
  options: RepairToolInputOptions = {}
): RepairToolInputResult {
  const spec = repairSchemaSpecs[schemaName];
  return repairToolInputWithSpec(modelId, spec, input, options);
}

export function repairToolInputWithSpec(
  modelId: CanonicalModelId,
  spec: RepairSchemaSpec,
  input: unknown,
  options: RepairToolInputOptions = {}
): RepairToolInputResult {
  const policy = loadModelPolicy(modelId);
  const firstValidation = spec.schema.safeParse(input);
  const toolName = options.toolName ?? spec.name;

  if (firstValidation.success) {
    return {
      valid: true,
      repaired: false,
      schemaName: spec.name,
      modelId,
      data: firstValidation.data,
      notes: []
    };
  }

  const originalIssues = firstValidation.error.issues;
  options.telemetry?.record({
    type: telemetryEvent.toolInputInvalid,
    sessionId: options.sessionId,
    modelId,
    toolName,
    metadata: {
      schemaName: spec.name,
      issues: originalIssues.map(summarizeIssue)
    }
  });

  const working = cloneInput(input);
  const notes: Note[] = [];
  const noteKeys = new Set<string>();
  const enabledRepairs = new Set(policy.repairs);

  for (const repair of repairExecutionOrder) {
    if (!enabledRepairs.has(repair)) {
      continue;
    }

    for (const issue of originalIssues) {
      applyRepairAtIssuePath(repair, spec, working, issue.path, notes, noteKeys);
    }
  }

  const repairedValidation = spec.schema.safeParse(working);

  if (!repairedValidation.success) {
    const finalIssues = repairedValidation.error.issues;
    const invalidResponse = makeInvalidToolResponse({
      toolName: spec.name,
      issues: finalIssues,
      expectedShape: spec.expectedShape
    });
    return {
      valid: false,
      repaired: notes.length > 0,
      schemaName: spec.name,
      modelId,
      repairedInput: working,
      notes,
      issues: invalidResponse.issues,
      modelMessage: invalidResponse.modelMessage,
      error: invalidResponse.error
    };
  }

  if (notes.length > 0) {
    options.telemetry?.record({
      type: telemetryEvent.toolInputRepaired,
      sessionId: options.sessionId,
      modelId,
      toolName,
      metadata: {
        schemaName: spec.name,
        repairs: notes.map((note) => note.code.replace(/^repair\./, "")),
        notes
      }
    });
  }

  return {
    valid: true,
    repaired: notes.length > 0,
    schemaName: spec.name,
    modelId,
    data: repairedValidation.data,
    repairedInput: repairedValidation.data,
    notes
  };
}

function applyRepairAtIssuePath(
  repair: RepairName,
  spec: RepairSchemaSpec,
  input: unknown,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  if (!isPlainObject(input)) {
    return;
  }

  switch (repair) {
    case repairName.stripNullOptional:
      stripNullOptional(spec, input, issuePath, notes, noteKeys);
      break;
    case repairName.emptyObjectToArray:
      emptyObjectToArray(spec, input, issuePath, notes, noteKeys);
      break;
    case repairName.parseJsonArrayString:
      parseJsonArrayString(spec, input, issuePath, notes, noteKeys);
      break;
    case repairName.bareStringToArray:
      bareStringToArray(spec, input, issuePath, notes, noteKeys);
      break;
    case repairName.markdownPathAutolinkUnwrap:
      markdownPathAutolinkUnwrap(spec, input, issuePath, notes, noteKeys);
      break;
  }
}

function stripNullOptional(
  spec: RepairSchemaSpec,
  input: Record<string, unknown>,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  const field = exactTopLevelField(issuePath);
  if (!field || !spec.optionalFields.includes(field) || input[field] !== null) {
    return;
  }

  delete input[field];
  pushNote(notes, noteKeys, {
    code: repairNoteCode(repairName.stripNullOptional),
    path: field,
    message: `Removed null optional field ${field}.`
  });
}

function emptyObjectToArray(
  spec: RepairSchemaSpec,
  input: Record<string, unknown>,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  const field = exactTopLevelField(issuePath);
  const value = field ? input[field] : undefined;
  if (!field || !spec.arrayFields.includes(field) || !isEmptyPlainObject(value)) {
    return;
  }

  input[field] = [];
  pushNote(notes, noteKeys, {
    code: repairNoteCode(repairName.emptyObjectToArray),
    path: field,
    message: `Converted empty object placeholder at ${field} to an empty array.`
  });
}

function parseJsonArrayString(
  spec: RepairSchemaSpec,
  input: Record<string, unknown>,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  const field = exactTopLevelField(issuePath);
  const value = field ? input[field] : undefined;
  if (!field || !spec.arrayFields.includes(field) || typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) {
    return;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      input[field] = parsed;
      pushNote(notes, noteKeys, {
        code: repairNoteCode(repairName.parseJsonArrayString),
        path: field,
        message: `Parsed JSON array string at ${field}.`
      });
    }
  } catch {
    // Invalid JSON is left for bareStringToArray or final validation.
  }
}

function bareStringToArray(
  spec: RepairSchemaSpec,
  input: Record<string, unknown>,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  const field = exactTopLevelField(issuePath);
  const value = field ? input[field] : undefined;
  if (!field || !spec.arrayFields.includes(field) || typeof value !== "string") {
    return;
  }

  input[field] = [value];
  pushNote(notes, noteKeys, {
    code: repairNoteCode(repairName.bareStringToArray),
    path: field,
    message: `Wrapped bare string at ${field} as a one-item array.`
  });
}

function markdownPathAutolinkUnwrap(
  spec: RepairSchemaSpec,
  input: Record<string, unknown>,
  issuePath: readonly IssuePathSegment[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  const topLevelField = issuePath[0];
  if (typeof topLevelField !== "string") {
    return;
  }

  if (issuePath.length === 1 && spec.pathStringFields.includes(topLevelField)) {
    const value = input[topLevelField];
    if (typeof value === "string") {
      unwrapAtTopLevel(input, topLevelField, notes, noteKeys);
    }
    return;
  }

  if (issuePath.length === 1 && spec.pathStringArrayFields.includes(topLevelField)) {
    const value = input[topLevelField];
    if (Array.isArray(value)) {
      unwrapArrayItems(input, topLevelField, value, notes, noteKeys);
    }
    return;
  }

  if (
    issuePath.length === 2 &&
    typeof issuePath[1] === "number" &&
    spec.pathStringArrayFields.includes(topLevelField)
  ) {
    const value = input[topLevelField];
    if (!Array.isArray(value)) {
      return;
    }

    const index = issuePath[1];
    const item = value[index];
    if (typeof item !== "string") {
      return;
    }

    const unwrapped = unwrapDegenerateMarkdownPathAutolink(item);
    if (unwrapped !== item) {
      value[index] = unwrapped;
      pushNote(notes, noteKeys, {
        code: repairNoteCode(repairName.markdownPathAutolinkUnwrap),
        path: pathToString(issuePath),
        message: `Unwrapped degenerate markdown auto-link at ${pathToString(issuePath)}.`
      });
    }
  }
}

function unwrapAtTopLevel(
  input: Record<string, unknown>,
  field: string,
  notes: Note[],
  noteKeys: Set<string>
): void {
  const value = input[field];
  if (typeof value !== "string") {
    return;
  }

  const unwrapped = unwrapDegenerateMarkdownPathAutolink(value);
  if (unwrapped !== value) {
    input[field] = unwrapped;
    pushNote(notes, noteKeys, {
      code: repairNoteCode(repairName.markdownPathAutolinkUnwrap),
      path: field,
      message: `Unwrapped degenerate markdown auto-link at ${field}.`
    });
  }
}

function unwrapArrayItems(
  input: Record<string, unknown>,
  field: string,
  value: unknown[],
  notes: Note[],
  noteKeys: Set<string>
): void {
  let changed = false;
  const next = value.map((item) => {
    if (typeof item !== "string") {
      return item;
    }

    const unwrapped = unwrapDegenerateMarkdownPathAutolink(item);
    changed ||= unwrapped !== item;
    return unwrapped;
  });

  if (changed) {
    input[field] = next;
    pushNote(notes, noteKeys, {
      code: repairNoteCode(repairName.markdownPathAutolinkUnwrap),
      path: field,
      message: `Unwrapped degenerate markdown auto-links in ${field}.`
    });
  }
}

function unwrapDegenerateMarkdownPathAutolink(value: string): string {
  const markdownLink = value.match(/^\[([^\]]+)]\(([^)]+)\)$/);
  if (markdownLink && markdownLink[1] === markdownLink[2]) {
    return markdownLink[2];
  }

  const angleAutolink = value.match(/^<([^<>\n]+)>$/);
  if (angleAutolink) {
    return angleAutolink[1];
  }

  return value;
}

function exactTopLevelField(issuePath: readonly IssuePathSegment[]): string | undefined {
  return issuePath.length === 1 && typeof issuePath[0] === "string"
    ? issuePath[0]
    : undefined;
}

function pushNote(notes: Note[], noteKeys: Set<string>, note: Note): void {
  const key = `${note.code}:${note.path ?? ""}`;
  if (noteKeys.has(key)) {
    return;
  }

  noteKeys.add(key);
  notes.push(note);
}

function cloneInput(input: unknown): unknown {
  if (input === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(input)) as unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isEmptyPlainObject(value: unknown): value is Record<string, never> {
  return isPlainObject(value) && Object.keys(value).length === 0;
}
