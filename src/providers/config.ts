import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import type { CanonicalModelId, ProviderId } from "../types.js";
import { canonicalModelIds, providerIds } from "../types.js";

export const stickySessionStrategies = ["raw", "hash"] as const;

export type StickySessionStrategy = (typeof stickySessionStrategies)[number];

const stickySessionSchema = z
  .object({
    header: z.string().min(1),
    strategy: z.enum(stickySessionStrategies)
  })
  .strict();

const envVarNameSchema = z
  .string()
  .min(1)
  .regex(/^[A-Z_][A-Z0-9_]*$/, "must be an environment variable name");

const providerConfigSchema = z
  .object({
    id: z.enum(providerIds),
    baseUrlEnv: envVarNameSchema,
    authEnvVar: envVarNameSchema,
    stickySession: stickySessionSchema,
    modelSlugs: z.record(
      z.enum(canonicalModelIds),
      z
        .object({
          env: envVarNameSchema.optional(),
          default: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

const providerConfigFileSchema = z
  .object({
    providers: z.array(providerConfigSchema).min(1)
  })
  .superRefine((config, context) => {
    const seen = new Set<ProviderId>();
    for (const [index, provider] of config.providers.entries()) {
      if (seen.has(provider.id)) {
        context.addIssue({
          code: "custom",
          path: ["providers", index, "id"],
          message: `duplicate provider id: ${provider.id}`
        });
      }
      seen.add(provider.id);
    }
    for (const providerId of providerIds) {
      if (!seen.has(providerId)) {
        context.addIssue({
          code: "custom",
          path: ["providers"],
          message: `missing provider id: ${providerId}`
        });
      }
    }
  })
  .strict();

export interface StickySessionConfig {
  header: string;
  strategy: StickySessionStrategy;
}

export interface ProviderRuntimeConfig {
  id: ProviderId;
  stickySession: StickySessionConfig;
}

export interface ProviderModelSlugConfig {
  env?: string;
  default: string;
}

export interface ProviderRuntimeDefinition extends ProviderRuntimeConfig {
  baseUrlEnv: string;
  authEnvVar: string;
  modelSlugs: Record<CanonicalModelId, ProviderModelSlugConfig>;
}

export type ProviderRuntimeConfigMap = Record<ProviderId, ProviderRuntimeDefinition>;

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export function loadProviderRuntimeConfigs(): ProviderRuntimeConfigMap {
  const raw = readFileSync(resolveProviderConfigPath(), "utf8");
  return parseProviderRuntimeConfigs(YAML.parse(raw));
}

export function parseProviderRuntimeConfigs(rawConfig: unknown): ProviderRuntimeConfigMap {
  const parsed = providerConfigFileSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new ProviderConfigError(formatProviderConfigIssues(parsed.error.issues));
  }

  return parsed.data.providers.reduce((configs, provider) => {
    configs[provider.id] = provider;
    return configs;
  }, {} as ProviderRuntimeConfigMap);
}

function resolveProviderConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "providers.yaml"),
    resolve(here, "..", "..", "src", "providers", "providers.yaml"),
    resolve(process.cwd(), "src", "providers", "providers.yaml")
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new ProviderConfigError("Provider config file not found");
  }

  return found;
}

function formatProviderConfigIssues(issues: z.core.$ZodIssue[]): string {
  const details = issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "<root>";
    return `${path}: ${issue.message}`;
  });

  return `Provider config is invalid: ${details.join("; ")}`;
}
