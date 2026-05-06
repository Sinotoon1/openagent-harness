import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { CanonicalModelId } from "../types.js";
import { canonicalModelIds } from "../types.js";
import { modelPolicySchema, type ModelPolicy } from "./types.js";

const policyCache = new Map<CanonicalModelId, ModelPolicy>();

export function loadModelPolicy(modelId: CanonicalModelId): ModelPolicy {
  const cached = policyCache.get(modelId);
  if (cached) {
    return cached;
  }

  const policy = readPolicyFile(modelId);
  policyCache.set(modelId, policy);
  return policy;
}

export function loadAllModelPolicies(): ModelPolicy[] {
  return canonicalModelIds.map((modelId) => loadModelPolicy(modelId));
}

function readPolicyFile(modelId: CanonicalModelId): ModelPolicy {
  const policyPath = resolvePolicyPath(modelId);
  const raw = readFileSync(policyPath, "utf8");
  const parsed = YAML.parse(raw);
  return modelPolicySchema.parse(parsed);
}

function resolvePolicyPath(modelId: CanonicalModelId): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, `${modelId}.yaml`),
    resolve(here, "..", "..", "src", "policies", `${modelId}.yaml`),
    resolve(process.cwd(), "src", "policies", `${modelId}.yaml`)
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Policy file not found for ${modelId}`);
  }

  return found;
}
