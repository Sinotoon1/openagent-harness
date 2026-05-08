import type { RepairToolInputResult } from "../repair/engine.js";
import { sanitizeForResponse } from "../security/sanitize.js";
import type { NormalizeToolInputResult } from "./normalizeToolInput.js";

export function toRepairToolResponse(
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

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
