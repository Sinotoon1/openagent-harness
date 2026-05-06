import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(root, "..");
copyYamlDir(resolve(repoRoot, "src", "policies"), resolve(repoRoot, "dist", "policies"), true);
copyYamlDir(resolve(repoRoot, "src", "providers"), resolve(repoRoot, "dist", "providers"), false);

function copyYamlDir(source, target, removeSourceTs) {
  if (!existsSync(source)) {
    return;
  }

  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(target)) {
    if (
      entry.endsWith(".yaml") ||
      (removeSourceTs && entry.endsWith(".ts") && !entry.endsWith(".d.ts"))
    ) {
      rmSync(resolve(target, entry));
    }
  }
  for (const entry of readdirSync(source)) {
    if (entry.endsWith(".yaml")) {
      copyFileSync(resolve(source, entry), resolve(target, entry));
    }
  }
}
