export const redactedValue = "<redacted>";

const defaultMaxDepth = 6;
const defaultMaxArrayLength = 25;
const defaultMaxObjectKeys = 50;
const defaultMaxStringLength = 500;

const secretKeyFragments = [
  "apikey",
  "authorization",
  "token",
  "secret",
  "password",
  "bearer",
  "credential",
  "cookie",
  "session"
] as const;

const riskyFieldNames = new Set([
  "messages",
  "content",
  "filecontent",
  "filecontents",
  "command",
  "stdout",
  "stderr",
  "headers",
  "env"
]);

export interface SanitizeOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

interface SanitizeLimits {
  maxDepth: number;
  maxArrayLength: number;
  maxObjectKeys: number;
  maxStringLength: number;
}

export function sanitizeForResponse(input: unknown, options: SanitizeOptions = {}): unknown {
  return sanitizeValue(input, normalizeOptions(options), 0);
}

export function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  options: SanitizeOptions = {}
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized = sanitizeForResponse(metadata, options);
  return isRecord(sanitized) ? sanitized : { value: sanitized };
}

function sanitizeValue(value: unknown, limits: SanitizeLimits, depth: number): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, limits.maxStringLength);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (depth >= limits.maxDepth) {
    return "<omitted:max-depth>";
  }

  if (Array.isArray(value)) {
    return sanitizeArray(value, limits, depth);
  }

  if (!isRecord(value)) {
    return String(value);
  }

  return sanitizeObject(value, limits, depth);
}

function sanitizeObject(
  value: Record<string, unknown>,
  limits: SanitizeLimits,
  depth: number
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const entries = Object.entries(value).slice(0, limits.maxObjectKeys);

  for (const [key, nested] of entries) {
    if (isSecretKey(key)) {
      output[key] = redactedValue;
      continue;
    }

    if (isRiskyField(key)) {
      output[key] = summarizeRiskyField(key, nested);
      continue;
    }

    output[key] = sanitizeValue(nested, limits, depth + 1);
  }

  const omittedKeys = Object.keys(value).length - entries.length;
  if (omittedKeys > 0) {
    output.__omittedKeys = omittedKeys;
  }

  return output;
}

function sanitizeArray(value: unknown[], limits: SanitizeLimits, depth: number): unknown[] {
  const output = value
    .slice(0, limits.maxArrayLength)
    .map((item) => sanitizeValue(item, limits, depth + 1));

  const omittedItems = value.length - output.length;
  if (omittedItems > 0) {
    output.push(`<omitted:${omittedItems}:items>`);
  }

  return output;
}

function summarizeRiskyField(key: string, value: unknown): string {
  const normalized = normalizeKey(key);

  if (typeof value === "string") {
    return `<omitted:${normalized}:${value.length}:chars>`;
  }

  if (Array.isArray(value)) {
    return `<omitted:${normalized}:${value.length}:items>`;
  }

  if (isRecord(value)) {
    return `<omitted:${normalized}:${Object.keys(value).length}:keys>`;
  }

  if (value === null || value === undefined) {
    return `<omitted:${normalized}:empty>`;
  }

  return `<omitted:${normalized}:${typeof value}>`;
}

function sanitizeString(value: string, maxStringLength: number): string {
  if (looksLikeSecretValue(value)) {
    return redactedValue;
  }

  if (value.length <= maxStringLength) {
    return value;
  }

  return `${value.slice(0, maxStringLength)}...<truncated:${value.length - maxStringLength}:chars>`;
}

function looksLikeSecretValue(value: string): boolean {
  return (
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(value) ||
    /\b(?:api[_-]?key|token|secret|password|credential|cookie)\s*[:=]\s*\S{4,}/i.test(value) ||
    /\bsk-[A-Za-z0-9_-]{8,}/.test(value)
  );
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized === "sessionidhash") {
    return false;
  }
  return secretKeyFragments.some((fragment) => normalized.includes(fragment));
}

function isRiskyField(key: string): boolean {
  return riskyFieldNames.has(normalizeKey(key));
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeOptions(options: SanitizeOptions): SanitizeLimits {
  return {
    maxDepth: options.maxDepth ?? defaultMaxDepth,
    maxArrayLength: options.maxArrayLength ?? defaultMaxArrayLength,
    maxObjectKeys: options.maxObjectKeys ?? defaultMaxObjectKeys,
    maxStringLength: options.maxStringLength ?? defaultMaxStringLength
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
