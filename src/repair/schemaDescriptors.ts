import { z } from "zod";
import type { IssueLike } from "../validation/invalidResponse.js";
import {
  pathStringSchema,
  type RepairSchemaSpec
} from "./schemaSpecs.js";

const maxDescriptorFields = 50;
const maxDescriptorPathEntries = 25;
const maxSchemaDepth = 5;
const maxRepairPathDepth = 1;

const dangerousDescriptorKeys = new Set(["__proto__", "prototype", "constructor"]);
const fieldNameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => !containsDangerousDescriptorKey(value), {
    message:
      "Descriptor field names and paths must not contain __proto__, prototype, or constructor."
  });

export type CallerRepairSchemaType = "string" | "number" | "boolean" | "array" | "object";

export interface CallerRepairSchemaNode {
  type: CallerRepairSchemaType;
  optional?: boolean;
  items?: CallerRepairSchemaNode;
  properties?: Record<string, CallerRepairSchemaNode>;
  required?: string[];
}

export interface CallerRepairSchemaDescriptor {
  toolName: string;
  schema: CallerRepairSchemaNode;
  pathStringFields?: string[];
  pathStringArrayFields?: string[];
}

const callerRepairSchemaNodeSchema: z.ZodType<CallerRepairSchemaNode> = z.lazy(() =>
  z
    .object({
      type: z.enum(["string", "number", "boolean", "array", "object"]),
      optional: z.boolean().optional(),
      items: callerRepairSchemaNodeSchema.optional(),
      properties: z.record(fieldNameSchema, callerRepairSchemaNodeSchema).optional(),
      required: z.array(fieldNameSchema).max(maxDescriptorFields).optional()
    })
    .strict()
);

export const callerRepairSchemaDescriptorInputSchema = z
  .object({
    toolName: z.string().min(1).max(120),
    schema: callerRepairSchemaNodeSchema,
    pathStringFields: z.array(fieldNameSchema).max(maxDescriptorPathEntries).optional(),
    pathStringArrayFields: z.array(fieldNameSchema).max(maxDescriptorPathEntries).optional()
  })
  .strict();

export type CallerRepairSchemaDescriptorInput = z.infer<
  typeof callerRepairSchemaDescriptorInputSchema
>;

export type BuildRepairSchemaSpecResult =
  | { valid: true; spec: RepairSchemaSpec }
  | { valid: false; issues: IssueLike[]; expectedShape: string };

export function findDangerousDescriptorKeyIssues(input: unknown): IssueLike[] {
  if (!isRecord(input) || !("schemaDescriptor" in input)) {
    return [];
  }

  const descriptor = input.schemaDescriptor;
  if (!isRecord(descriptor)) {
    return [];
  }

  const issues: IssueLike[] = [];
  scanDangerousDescriptorKeys(descriptor, ["schemaDescriptor"], issues);
  return issues;
}

export function buildRepairSchemaSpecFromDescriptor(
  descriptor: CallerRepairSchemaDescriptor
): BuildRepairSchemaSpecResult {
  const issues: IssueLike[] = [];
  const pathStringFields = descriptor.pathStringFields ?? [];
  const pathStringArrayFields = descriptor.pathStringArrayFields ?? [];

  if (descriptor.schema.type !== "object") {
    issues.push(makeIssue(["schemaDescriptor", "schema", "type"], "Top-level schema type must be object."));
  }

  const fieldCount = countFields(descriptor.schema);
  if (fieldCount > maxDescriptorFields) {
    issues.push(
      makeIssue(
        ["schemaDescriptor", "schema"],
        `Schema descriptor has ${fieldCount} fields; maximum is ${maxDescriptorFields}.`
      )
    );
  }

  const depth = schemaDepth(descriptor.schema);
  if (depth > maxSchemaDepth) {
    issues.push(
      makeIssue(
        ["schemaDescriptor", "schema"],
        `Schema descriptor depth is ${depth}; maximum is ${maxSchemaDepth}.`
      )
    );
  }

  issues.push(...validateSchemaNode(descriptor.schema, ["schemaDescriptor", "schema"], 1));
  issues.push(
    ...validateRepairPaths(
      "pathStringFields",
      pathStringFields,
      descriptor.schema,
      (node) => node.type === "string"
    )
  );
  issues.push(
    ...validateRepairPaths(
      "pathStringArrayFields",
      pathStringArrayFields,
      descriptor.schema,
      (node) => node.type === "array" && node.items?.type === "string"
    )
  );

  if (issues.length > 0) {
    return {
      valid: false,
      issues,
      expectedShape: callerDescriptorExpectedShape
    };
  }

  return {
    valid: true,
    spec: {
      name: descriptor.toolName,
      schema: buildZodSchema(descriptor.schema, {
        path: [],
        pathStringFields: new Set(pathStringFields),
        pathStringArrayFields: new Set(pathStringArrayFields)
      }),
      arrayFields: topLevelArrayFields(descriptor.schema),
      optionalFields: topLevelOptionalFields(descriptor.schema),
      pathStringFields,
      pathStringArrayFields,
      expectedShape: describeExpectedShape(descriptor)
    }
  };
}

export const callerDescriptorExpectedShape =
  "{ toolName: string; schema: { type: object; properties: Record<string, SchemaNode>; required?: string[] }; pathStringFields?: string[]; pathStringArrayFields?: string[] }";

interface BuildZodOptions {
  path: string[];
  pathStringFields: Set<string>;
  pathStringArrayFields: Set<string>;
}

function buildZodSchema(node: CallerRepairSchemaNode, options: BuildZodOptions): z.ZodType<unknown> {
  const path = options.path.join(".");
  switch (node.type) {
    case "string":
      return options.pathStringFields.has(path) ? pathStringSchema : z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array": {
      const itemSchema =
        path && options.pathStringArrayFields.has(path)
          ? pathStringSchema
          : buildZodSchema(node.items!, { ...options, path: [...options.path, "[]"] });
      return z.array(itemSchema);
    }
    case "object": {
      const properties = node.properties ?? {};
      const required = requiredFields(node);
      const shape = Object.create(null) as Record<string, z.ZodType<unknown>>;
      for (const [field, child] of Object.entries(properties)) {
        const childSchema = buildZodSchema(child, {
          ...options,
          path: [...options.path, field]
        });
        shape[field] = required.has(field) ? childSchema : childSchema.optional();
      }
      return z.object(shape).strict();
    }
  }
}

function validateSchemaNode(
  node: CallerRepairSchemaNode,
  path: Array<string | number>,
  depth: number
): IssueLike[] {
  const issues: IssueLike[] = [];

  if (depth > maxSchemaDepth) {
    return issues;
  }

  if (node.type === "array") {
    if (!node.items) {
      issues.push(makeIssue([...path, "items"], "Array schema nodes must declare items."));
    } else {
      issues.push(...validateSchemaNode(node.items, [...path, "items"], depth + 1));
    }
  }

  if (node.type === "object") {
    const properties = node.properties ?? {};
    const propertyNames = new Set(Object.keys(properties));
    for (const field of node.required ?? []) {
      if (containsDangerousDescriptorKey(field)) {
        issues.push(makeDangerousKeyIssue([...path, "required"], field));
        continue;
      }

      if (!propertyNames.has(field)) {
        issues.push(makeIssue([...path, "required"], `Required field ${field} is not declared in properties.`));
      }
    }

    for (const [field, child] of Object.entries(properties)) {
      if (containsDangerousDescriptorKey(field)) {
        issues.push(makeDangerousKeyIssue([...path, "properties", field], field));
        continue;
      }

      issues.push(...validateSchemaNode(child, [...path, "properties", field], depth + 1));
    }
  }

  return issues;
}

function validateRepairPaths(
  field: "pathStringFields" | "pathStringArrayFields",
  paths: string[],
  schema: CallerRepairSchemaNode,
  matchesExpectedNode: (node: CallerRepairSchemaNode) => boolean
): IssueLike[] {
  const issues: IssueLike[] = [];
  const properties = schema.properties ?? {};

  for (const [index, path] of paths.entries()) {
    const parts = path.split(".");
    if (containsDangerousDescriptorKey(path)) {
      issues.push(makeDangerousKeyIssue(["schemaDescriptor", field, index], path));
      continue;
    }

    if (parts.length > maxRepairPathDepth) {
      issues.push(
        makeIssue(
          ["schemaDescriptor", field, index],
          `Repair paths may only reference top-level fields; maximum path depth is ${maxRepairPathDepth}.`
        )
      );
      continue;
    }

    const node = properties[path];
    if (!node || !matchesExpectedNode(node)) {
      issues.push(
        makeIssue(
          ["schemaDescriptor", field, index],
          `${field} entry ${path} must reference a compatible top-level schema field.`
        )
      );
    }
  }

  return issues;
}

function topLevelArrayFields(schema: CallerRepairSchemaNode): string[] {
  return Object.entries(schema.properties ?? {})
    .filter(([, node]) => node.type === "array")
    .map(([field]) => field);
}

function topLevelOptionalFields(schema: CallerRepairSchemaNode): string[] {
  const required = requiredFields(schema);
  return Object.entries(schema.properties ?? {})
    .filter(([field, node]) => node.optional === true || !required.has(field))
    .map(([field]) => field);
}

function requiredFields(node: CallerRepairSchemaNode): Set<string> {
  const propertyNames = Object.keys(node.properties ?? {});
  const optionalByFlag = new Set(
    Object.entries(node.properties ?? {})
      .filter(([, child]) => child.optional === true)
      .map(([field]) => field)
  );
  const required = node.required ?? propertyNames.filter((field) => !optionalByFlag.has(field));
  return new Set(required.filter((field) => !optionalByFlag.has(field)));
}

function countFields(node: CallerRepairSchemaNode): number {
  if (node.type === "array") {
    return node.items ? countFields(node.items) : 0;
  }

  if (node.type !== "object") {
    return 0;
  }

  return Object.values(node.properties ?? {}).reduce(
    (count, child) => count + 1 + countFields(child),
    0
  );
}

function schemaDepth(node: CallerRepairSchemaNode): number {
  if (node.type === "array") {
    return 1 + (node.items ? schemaDepth(node.items) : 0);
  }

  if (node.type !== "object") {
    return 1;
  }

  const childDepth = Object.values(node.properties ?? {}).reduce(
    (max, child) => Math.max(max, schemaDepth(child)),
    0
  );
  return 1 + childDepth;
}

function describeExpectedShape(descriptor: CallerRepairSchemaDescriptor): string {
  const required = requiredFields(descriptor.schema);
  const properties = Object.entries(descriptor.schema.properties ?? {}).map(([field, node]) => {
    const suffix = required.has(field) ? "" : "?";
    return `${field}${suffix}: ${describeNode(field, node, descriptor)}`;
  });

  return `{ ${properties.join("; ")} }`;
}

function describeNode(
  field: string,
  node: CallerRepairSchemaNode,
  descriptor: CallerRepairSchemaDescriptor
): string {
  if (descriptor.pathStringFields?.includes(field)) {
    return "plain path string";
  }

  if (descriptor.pathStringArrayFields?.includes(field)) {
    return "plain path string[]";
  }

  if (node.type === "array") {
    return `${node.items ? describeNode(`${field}[]`, node.items, descriptor) : "unknown"}[]`;
  }

  return node.type;
}

function makeIssue(path: Array<string | number>, message: string): IssueLike {
  return {
    code: "invalid_value",
    path,
    message
  };
}

function makeDangerousKeyIssue(path: Array<string | number>, value: string): IssueLike {
  return makeIssue(
    path,
    `Descriptor field names and paths must not contain dangerous object key ${value}.`
  );
}

function scanDangerousDescriptorKeys(
  value: unknown,
  path: Array<string | number>,
  issues: IssueLike[]
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (typeof item === "string" && shouldValidateDescriptorPathString(path)) {
        const dangerousKey = dangerousKeyInPath(item);
        if (dangerousKey) {
          issues.push(makeDangerousKeyIssue([...path, index], dangerousKey));
        }
      }
      scanDangerousDescriptorKeys(item, [...path, index], issues);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    const dangerousKey = dangerousKeyInPath(key);
    if (dangerousKey) {
      issues.push(makeDangerousKeyIssue([...path, key], dangerousKey));
      continue;
    }

    scanDangerousDescriptorKeys(value[key], [...path, key], issues);
  }
}

function containsDangerousDescriptorKey(value: string): boolean {
  return dangerousKeyInPath(value) !== undefined;
}

function dangerousKeyInPath(value: string): string | undefined {
  return value.split(".").find((segment) => dangerousDescriptorKeys.has(segment));
}

function shouldValidateDescriptorPathString(path: Array<string | number>): boolean {
  const key = path[path.length - 1];
  return (
    key === "pathStringFields" ||
    key === "pathStringArrayFields" ||
    key === "required"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
