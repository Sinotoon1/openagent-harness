import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import type { ProviderId } from "../types.js";
import { providerIds } from "../types.js";

export const stickySessionStrategies = ["raw", "hash"] as const;

export type StickySessionStrategy = (typeof stickySessionStrategies)[number];

const stickySessionSchema = z
  .object({
    header: z.string().min(1),
    strategy: z.enum(stickySessionStrategies)
  })
  .strict();

const providerConfigFileSchema = z
  .object({
    providers: z.record(
      z.enum(providerIds),
      z
        .object({
          stickySession: stickySessionSchema
        })
        .strict()
    )
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

export type ProviderRuntimeConfigMap = Record<ProviderId, ProviderRuntimeConfig>;

export function loadProviderRuntimeConfigs(): ProviderRuntimeConfigMap {
  const raw = readFileSync(resolveProviderConfigPath(), "utf8");
  const parsed = providerConfigFileSchema.parse(YAML.parse(raw));

  return providerIds.reduce((configs, providerId) => {
    const provider = parsed.providers[providerId];
    configs[providerId] = {
      id: providerId,
      stickySession: provider.stickySession
    };
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
    throw new Error("Provider config file not found");
  }

  return found;
}
