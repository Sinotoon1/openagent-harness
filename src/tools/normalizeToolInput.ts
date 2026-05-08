import type { CanonicalModelId, Note } from "../types.js";
import type { TelemetrySink } from "../telemetry/types.js";
import { telemetryEvent } from "../constants/telemetryEvents.js";
import { repairSchemaSpecs, type RepairSchemaName } from "../repair/schemaSpecs.js";
import { applyReadFileRelationalDefaults } from "./readFileDefaults.js";

export interface NormalizeToolInputOptions {
  telemetry?: TelemetrySink;
  sessionId?: string;
  modelId?: CanonicalModelId;
  toolName?: string;
}

export interface NormalizeToolInputResult {
  valid: boolean;
  normalized: boolean;
  schemaName: RepairSchemaName;
  data?: unknown;
  normalizedInput?: unknown;
  notes: Note[];
  issues?: unknown;
}

export function normalizeToolInput(
  schemaName: RepairSchemaName,
  input: unknown,
  options: NormalizeToolInputOptions = {}
): NormalizeToolInputResult {
  const spec = repairSchemaSpecs[schemaName];
  const validation = spec.schema.safeParse(input);

  if (!validation.success) {
    return {
      valid: false,
      normalized: false,
      schemaName,
      notes: [],
      issues: validation.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  if (schemaName !== "readFile") {
    return {
      valid: true,
      normalized: false,
      schemaName,
      data: validation.data,
      notes: []
    };
  }

  const defaults = applyReadFileRelationalDefaults(
    validation.data as { pathString: string; limit?: number; offset?: number; reason?: string }
  );

  if (defaults.notes.length > 0) {
    options.telemetry?.record({
      type: telemetryEvent.toolInputNormalized,
      sessionId: options.sessionId,
      modelId: options.modelId,
      toolName: options.toolName ?? schemaName,
      metadata: {
        schemaName,
        notes: defaults.notes
      }
    });
  }

  return {
    valid: true,
    normalized: defaults.notes.length > 0,
    schemaName,
    data: defaults.input,
    normalizedInput: defaults.notes.length > 0 ? defaults.input : undefined,
    notes: defaults.notes
  };
}
