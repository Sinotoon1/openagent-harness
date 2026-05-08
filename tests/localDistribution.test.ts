import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("local distribution hygiene", () => {
  it("keeps local-only artifacts ignored while preserving committed examples", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain(".env.local");
    expect(gitignore).toContain("providers.local.yaml");
    expect(gitignore).toContain("*.jsonl");
    expect(gitignore).toContain("package/");
    expect(gitignore).toContain("*.tgz");
    expect(gitignore).not.toContain("examples/.env.example");
    expect(gitignore).not.toContain("examples/providers.local.example.yaml");
  });

  it("keeps example environment values placeholder-only", () => {
    const envExample = readFileSync("examples/.env.example", "utf8");
    const valueLines = envExample
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="));

    for (const line of valueLines) {
      const [name, value = ""] = line.split("=", 2);
      if (name.endsWith("_API_KEY")) {
        expect(value).toBe("replace-with-your-local-key");
      }
      if (name.endsWith("_BASE_URL")) {
        expect(value).toMatch(/^https:\/\/[a-z-]+\.example\/v1$/);
      }
    }

    expect(envExample).not.toMatch(/\bsk-[A-Za-z0-9]{12,}/);
    expect(envExample).not.toMatch(/\bBearer\s+/i);
  });

  it("keeps provider config example free of secret values", () => {
    const providerExample = readFileSync("examples/providers.local.example.yaml", "utf8");

    expect(providerExample).toContain("authEnvVar: DEEPSEEK_PRIMARY_API_KEY");
    expect(providerExample).toContain("authEnvVar: OPENROUTER_FALLBACK_API_KEY");
    expect(providerExample).not.toMatch(/\bapiKey\s*:/i);
    expect(providerExample).not.toMatch(/\btoken\s*:/i);
    expect(providerExample).not.toMatch(/\bsk-[A-Za-z0-9]{12,}/);
    expect(providerExample).not.toMatch(/\bBearer\s+/i);
  });
});
