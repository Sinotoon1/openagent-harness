# oss-agent-harness-mcp

TypeScript MCP server exposing an OSS coding-agent harness over stdio.

This project is a **v1 candidate**. It is not yet a production-ready v1 release.
The tool logic is transport-neutral: `src/server.ts` only wires stdio, while tools,
routing, repair, context compaction, telemetry, policies, and providers live in
separate modules so Streamable HTTP can be added later without changing tool logic.

## Status

All major P0 architecture from the audit is implemented:

- issue-path repair
- valid-input zero-touch
- repair vs normalization split
- model-readable retry messages
- sanitized MCP responses
- sanitized telemetry
- `sessionIdHash` telemetry instead of raw top-level `sessionId`
- canonical model ID boundary
- provider session pinning
- capability negotiation
- DeepSeek thinking override
- effective-context compaction
- telemetry query/report tools
- OpenAI-compatible SSE streaming
- fallback only before first meaningful output

## Tools

- `oss_chat`: routes chat through canonical model IDs, provider priority, retryable fallback, capability negotiation, session pinning, and provider/model overrides.
- `repair_tool_input`: validates first, repairs only after validation fails, then validates again.
- `compact_context`: compacts against effective context tokens, never advertised context.
- `get_model_policy`: returns YAML-backed policy for one or all canonical models.
- `record_eval_event`: records evaluation telemetry.
- `query_telemetry`: queries in-memory telemetry with bounded, redacted metadata.
- `suggest_repair_policy`: suggests repair policy order from repair telemetry without editing YAML.

Canonical model IDs used internally:

- `kimi-k2-6`
- `deepseek-v4-pro`
- `deepseek-flash`

Provider-specific slugs are translated only inside provider adapters.

## Provider configuration

Both providers are OpenAI-compatible HTTP adapters in this first version.

```bash
PROVIDER_ONE_BASE_URL=https://provider-one.example/v1
PROVIDER_ONE_API_KEY=...
PROVIDER_TWO_BASE_URL=https://provider-two.example/v1
PROVIDER_TWO_API_KEY=...
```

Optional slug overrides:

```bash
PROVIDER_ONE_KIMI_K2_6_SLUG=...
PROVIDER_ONE_DEEPSEEK_V4_PRO_SLUG=...
PROVIDER_ONE_DEEPSEEK_FLASH_SLUG=...
PROVIDER_TWO_KIMI_K2_6_SLUG=...
PROVIDER_TWO_DEEPSEEK_V4_PRO_SLUG=...
PROVIDER_TWO_DEEPSEEK_FLASH_SLUG=...
```

Sticky session headers are configured in `src/providers/providers.yaml` and copied to
`dist/providers/providers.yaml` during build:

```yaml
providers:
  providerOne:
    stickySession:
      header: X-Session-Id
      strategy: raw
  providerTwo:
    stickySession:
      header: X-Routing-Key
      strategy: hash
```

## Hardening behavior

Tool responses are sanitized before they are serialized back over MCP. Full raw
inputs are not echoed by default. `repair_tool_input` returns flags, repairs,
changed paths, notes, and a `sanitizedOutputPreview`; it does not return raw
`input`, `data`, `repairedInput`, or `normalizedInput` payloads.

Invalid tool inputs return a standardized response with a concise `modelMessage`
for the model and structured `issues` for developers:

```json
{
  "valid": false,
  "modelMessage": "Tool get_model_policy input is invalid. ...",
  "issues": [{ "code": "invalid_value", "path": "modelId", "message": "..." }],
  "error": {
    "code": "tool_input_invalid",
    "toolName": "get_model_policy",
    "modelMessage": "Tool get_model_policy input is invalid. ...",
    "issues": [],
    "expectedShape": "{ modelId?: canonicalModelId }"
  }
}
```

Repair and normalization are separate. `repair_tool_input` validates first and only
repairs after schema validation fails; valid input is zero-touch and returns
`repaired=false`. Semantic defaults, such as `readFile` applying `offset = 0`
when only `limit` is present or `limit = 2000` when only `offset` is present,
run through normalization and emit `tool_input_normalized`.

Repairs are issue-path precise. The repair engine iterates over Zod issue paths
and only edits fields reported by validation. For example, markdown path
auto-link unwrapping can run for configured `pathString` fields and path arrays,
but it will not touch `writeFile.content` or any other non-issue field.

Telemetry is held in memory for this v1 candidate and resets on process restart.
Metadata is sanitized at the
telemetry sink boundary and again before MCP responses. Secret-shaped keys such
as `apiKey`, `authorization`, `token`, `secret`, `password`, `bearer`,
`credential`, `cookie`, and `session` are redacted with `<redacted>`. Nested
structures are depth-limited, arrays and object keys are bounded, and long
strings are truncated.

Raw top-level `sessionId` values are not stored in telemetry. The in-memory sink
stores a deterministic SHA-256 `sessionIdHash` instead, and `query_telemetry`
continues to support filtering by `sessionId` by hashing the query value before
matching. Set `OSS_HARNESS_TELEMETRY_SALT` in deployments so session hashes are
salted; without a salt they remain deterministic but are easier to compare
across environments. `sessionIdHash` is generated internally, and caller-provided
`sessionIdHash` values are not trusted or stored. The telemetry salt is read at
process startup/module initialization; changing it requires a process restart and
invalidates matching against previously stored in-memory telemetry.

Metadata uses a denylist for risky payload fields. Keys such as `messages`,
`content`, `fileContent`, `fileContents`, `command`, `stdout`, `stderr`,
`headers`, and `env` are summarized instead of returned raw. `query_telemetry`
never returns raw metadata; even with `includeMetadata=true`, metadata is the
bounded and sanitized form.

The OpenAI-compatible provider adapter supports OpenAI-style SSE streaming when
`streaming.enabled=true`, while preserving the existing non-streaming
`stream=false` path. Retryable provider failures may fallback only in the
`before_first_token` phase. Once a provider has produced meaningful assistant
output, including content deltas or tool-call deltas, failures are classified as
`after_first_token` and the router does not automatically switch providers.
Mid-stream provider switching is unsafe because it can merge partial output from
different providers. Remaining caveat: the MCP tool response still returns the
collected final text after the provider stream completes rather than exposing an
incremental MCP streaming transport to clients. Tool-call deltas are collected
as raw provider deltas in `raw.toolCallDeltas`; they are not reconstructed into
high-level tool calls yet. OpenAI-style single-line `data:` JSON chunks are
supported; SSE spec-style multi-line `data:` JSON events are not yet supported.

Capability negotiation is fallback-wide and conservative across the selected
provider set. A fallback provider that lacks a requested capability may cause the
primary attempt to drop that capability too. Per-attempt capability negotiation
is a future improvement.

Context compaction uses model effective-context policy and heuristic summaries.
It does not yet guarantee that the post-compaction context fits a target token
budget.

Repair telemetry can be summarized without editing model policies:

```bash
npm run telemetry:repair-report -- telemetry-events.json
```

The same suggestion loop is exposed through MCP:

```json
{
  "tool": "suggest_repair_policy",
  "arguments": {
    "modelId": "deepseek-v4-pro"
  }
}
```

Repair-policy suggestions are based on the bounded latest-200 telemetry window,
not full historical aggregation. Durable telemetry storage is not implemented
yet, and suggestion tools do not edit YAML policies.

## Usage examples

### `oss_chat` non-streaming

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "dev-session-1",
  "messages": [{ "role": "user", "content": "Summarize this change." }],
  "providerPriority": ["providerOne", "providerTwo"],
  "capabilities": { "zeroDataRetention": true }
}
```

### `oss_chat` streaming

The provider request uses SSE streaming, but the MCP response returns the final
collected output after the provider stream completes.

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "dev-session-1",
  "messages": [{ "role": "user", "content": "Draft a test plan." }],
  "streaming": { "enabled": true }
}
```

### `repair_tool_input`

```json
{
  "modelId": "deepseek-v4-pro",
  "schemaName": "pathBatch",
  "input": { "paths": "src/server.ts" }
}
```

### `compact_context`

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "dev-session-1",
  "messages": [{ "role": "user", "content": "Older context..." }],
  "usedTokens": 82000
}
```

### `query_telemetry`

```json
{
  "type": "provider_fallback",
  "sessionId": "dev-session-1",
  "includeMetadata": true,
  "limit": 20
}
```

### `suggest_repair_policy`

```json
{
  "modelId": "deepseek-v4-pro"
}
```

### `get_model_policy`

```json
{
  "modelId": "deepseek-flash"
}
```

### `record_eval_event`

```json
{
  "sessionId": "eval-session-1",
  "modelId": "kimi-k2-6",
  "eventName": "repair_regression_case",
  "outcome": "pass",
  "score": 1
}
```

## Development

```bash
npm install
npm test
npm run build
```

Run with stdio:

```bash
npm run dev
```

Or after building:

```bash
node dist/server.js
```

## MCP configuration examples

### Codex CLI

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.oss-agent-harness]
command = "node"
args = ["D:/Work/Python/openagent-harness/dist/server.js"]
enabled = true

[mcp_servers.oss-agent-harness.env]
PROVIDER_ONE_BASE_URL = "https://provider-one.example/v1"
PROVIDER_ONE_API_KEY = "YOUR_KEY"
PROVIDER_TWO_BASE_URL = "https://provider-two.example/v1"
PROVIDER_TWO_API_KEY = "YOUR_KEY"
```

### Claude Code

```bash
claude mcp add --transport stdio \
  --env PROVIDER_ONE_BASE_URL=https://provider-one.example/v1 \
  --env PROVIDER_ONE_API_KEY=YOUR_KEY \
  --env PROVIDER_TWO_BASE_URL=https://provider-two.example/v1 \
  --env PROVIDER_TWO_API_KEY=YOUR_KEY \
  oss-agent-harness \
  -- node D:/Work/Python/openagent-harness/dist/server.js
```

### VS Code

In `.vscode/mcp.json`:

```json
{
  "servers": {
    "ossAgentHarness": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/Work/Python/openagent-harness/dist/server.js"],
      "env": {
        "PROVIDER_ONE_BASE_URL": "https://provider-one.example/v1",
        "PROVIDER_ONE_API_KEY": "YOUR_KEY",
        "PROVIDER_TWO_BASE_URL": "https://provider-two.example/v1",
        "PROVIDER_TWO_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

### OpenCode

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "oss-agent-harness": {
      "type": "local",
      "command": ["node", "D:/Work/Python/openagent-harness/dist/server.js"],
      "enabled": true,
      "environment": {
        "PROVIDER_ONE_BASE_URL": "https://provider-one.example/v1",
        "PROVIDER_ONE_API_KEY": "YOUR_KEY",
        "PROVIDER_TWO_BASE_URL": "https://provider-two.example/v1",
        "PROVIDER_TWO_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```
