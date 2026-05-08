import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

export function tempTelemetryPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "oss-harness-tools-"));
  tempDirs.push(dir);
  return join(dir, "telemetry.jsonl");
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
