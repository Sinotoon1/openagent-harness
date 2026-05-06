import { createHash } from "node:crypto";

const telemetrySessionSalt = process.env.OSS_HARNESS_TELEMETRY_SALT;

export function hashSessionId(sessionId: string): string {
  return hashSessionIdWithSalt(sessionId, telemetrySessionSalt);
}

export function hashSessionIdWithSalt(sessionId: string, salt?: string): string {
  const hash = createHash("sha256");
  hash.update("oss-agent-harness-mcp:telemetry-session:v1\n");
  if (salt) {
    hash.update(`salt:${salt}\n`);
  }
  hash.update(`session:${sessionId}`);
  return hash.digest("hex");
}
