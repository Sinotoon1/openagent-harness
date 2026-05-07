# oss-agent-harness-mcp

TypeScript MCP server exposing an OSS coding-agent harness over stdio.

This project is a **v1 candidate**. It is not yet a production-ready v1 release.
The tool logic is transport-neutral: `src/server.ts` only wires stdio, while tools,
routing, repair, context compaction, telemetry, policies, and providers live in
separate modules so Streamable HTTP can be added later without changing tool logic.

## Responsibility Boundary

This MCP server is a model/provider-aware harness, not an IDE, coding agent,
provider gateway, observability product, billing system, workspace indexer, or
secret manager. Callers own context selection, workspace state, tool execution,
search, diagnostics, git state, and user-visible task state. The harness owns
only model-aware repair, routing/capability negotiation, session pinning,
context-budget safety checks, safe local telemetry, and streaming/fallback
guards.

IDE and coding-agent callers are responsible for deciding which files, messages,
diagnostics, shell output, git diffs, search results, and tool results belong in
the request. `compact_context` is only a model-aware context budget guard; it is
not a workspace memory system or relevance engine. `query_telemetry` and
`get_harness_stats` are local harness health tools, not billing, SLA, usage
analytics, or managed observability features. `record_eval_event` stores local
harness notes in telemetry only; broad eval pipeline management, experiment
tracking, dashboards, and research workflows remain out of scope.

Provider configuration validation is static config validation. It checks local
provider IDs, environment variable names, sticky-session settings, and slug
mappings; it does not validate live credentials, provider accounts, quota, cost,
or availability. Streaming support is provider-adapter safety and fallback
handling, not full agent event orchestration. `repair_tool_input` is a bounded
repair utility for known schema compatibility problems, not a general external
tool registry.

## What Not To Build

- workspace index/search
- diagnostics ingestion
- git diff tools
- shell/file execution
- provider account discovery
- live credential validation
- quota/cost tracking
- SLA dashboards
- usage analytics
- eval experiment management
- deployment/publish automation
- high-level agent tool-call orchestration

## Safe Future Work

- model policy validation
- caller-provided repair schema descriptors
- stricter compaction budget guarantees
- safer JSONL bounds
- provider capability metadata
- OpenAI-compatible streaming edge-case tests
- manual provider smoke-test docs
- narrower harness-specific telemetry event names

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
- per-attempt capability negotiation
- DeepSeek thinking override
- effective-context compaction
- telemetry query/report tools
- OpenAI-compatible SSE streaming
- fallback only before first meaningful output

## Tools

- `oss_chat`: routes chat through canonical model IDs, provider priority, retryable fallback, capability negotiation, session pinning, and provider/model overrides.
- `repair_tool_input`: validates first, repairs only after validation fails, then validates again; it is not a general external tool registry.
- `compact_context`: compacts against effective context tokens, never advertised context.
- `get_model_policy`: returns YAML-backed policy for one or all canonical models.
- `record_eval_event`: records local harness notes/telemetry only, not full eval-platform or experiment-tracker state.
- `query_telemetry`: queries configured local harness telemetry with bounded, redacted metadata.
- `get_harness_stats`: summarizes recent sanitized harness health telemetry, not billing or SLA observability.
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

Provider metadata is configured in `src/providers/providers.yaml` and copied to
`dist/providers/providers.yaml` during build. The loader validates provider IDs,
base URL environment variable names, auth environment variable names, sticky
session strategies, duplicate provider IDs, and model slug mappings. API key
values are read from the named environment variables at runtime and are not
required for tests. This validation is static config validation only; it does not
contact providers, validate live credentials, discover accounts, check quotas, or
verify cost/billing state.

```yaml
providers:
  - id: providerOne
    baseUrlEnv: PROVIDER_ONE_BASE_URL
    authEnvVar: PROVIDER_ONE_API_KEY
    stickySession:
      header: X-Session-Id
      strategy: raw
    modelSlugs:
      kimi-k2-6:
        env: PROVIDER_ONE_KIMI_K2_6_SLUG
        default: kimi-k2-6
      deepseek-v4-pro:
        env: PROVIDER_ONE_DEEPSEEK_V4_PRO_SLUG
        default: deepseek-v4-pro
      deepseek-flash:
        env: PROVIDER_ONE_DEEPSEEK_FLASH_SLUG
        default: deepseek-flash
  - id: providerTwo
    baseUrlEnv: PROVIDER_TWO_BASE_URL
    authEnvVar: PROVIDER_TWO_API_KEY
    stickySession:
      header: X-Routing-Key
      strategy: hash
    modelSlugs:
      kimi-k2-6:
        env: PROVIDER_TWO_KIMI_K2_6_SLUG
        default: kimi-k2-6
      deepseek-v4-pro:
        env: PROVIDER_TWO_DEEPSEEK_V4_PRO_SLUG
        default: deepseek-v4-pro
      deepseek-flash:
        env: PROVIDER_TWO_DEEPSEEK_FLASH_SLUG
        default: deepseek-flash
```

Provider names are placeholders until their `*_BASE_URL` and optional API key
environment variables point at real OpenAI-compatible services. See
[`docs/provider-matrix.md`](docs/provider-matrix.md) for provider smoke-test
guidance.

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
Built-in repair schemas are intentionally small compatibility helpers for this
harness. External IDE/tool schema ownership remains with the caller. Future
schema support should prefer caller-supplied schema descriptors rather than
expanding hard-coded schemas indefinitely.

Telemetry uses the memory sink by default and resets on process restart. An
optional JSONL sink can persist sanitized events to a local file:

```bash
OSS_HARNESS_TELEMETRY_SINK=memory

OSS_HARNESS_TELEMETRY_SINK=jsonl
OSS_HARNESS_TELEMETRY_JSONL_PATH=D:/logs/oss-agent-harness/telemetry.jsonl
```

The JSONL sink creates the file if it is missing and writes one sanitized event
per line. It is durable local-file telemetry for debugging and audits, not
billing, SLA, or managed observability telemetry. Metadata is sanitized at the
telemetry sink boundary and again before MCP responses. Secret-shaped keys such
as `apiKey`, `authorization`, `token`, `secret`, `password`, `bearer`,
`credential`, `cookie`, and `session` are redacted with `<redacted>`. Nested
structures are depth-limited, arrays and object keys are bounded, and long
strings are truncated.

Raw top-level `sessionId` values are not stored in telemetry. Sinks store a
deterministic SHA-256 `sessionIdHash` instead, and `query_telemetry` continues to
support filtering by `sessionId` by hashing the query value before matching. Set
`OSS_HARNESS_TELEMETRY_SALT` in deployments so session hashes are salted; without
a salt they remain deterministic but are easier to compare across environments.
`sessionIdHash` is generated internally, and caller-provided `sessionIdHash`
values are not trusted or stored. The telemetry salt is read at process
startup/module initialization; changing it requires a process restart and
invalidates matching against previously stored telemetry.

Metadata uses a denylist for risky payload fields. Keys such as `messages`,
`content`, `fileContent`, `fileContents`, `command`, `stdout`, `stderr`,
`headers`, and `env` are summarized instead of returned raw. `query_telemetry`
never returns raw metadata; even with `includeMetadata=true`, metadata is the
bounded and sanitized form.

`get_harness_stats` returns aggregate counts over the bounded latest telemetry
window using the same telemetry query path as `query_telemetry`, so `sessionId`
filters are hashed before matching and metadata remains sanitized. It reports
tool input invalid/repair/normalization counts, repair breakdowns, provider
fallbacks, streaming classifications, cache warmth hints, and context compaction
counts without returning raw metadata, raw sessions, messages, headers, commands,
file contents, or secrets. These stats summarize only the latest bounded window
rather than full telemetry history. These telemetry tools are local harness
health aids, not usage analytics, billing, quota, SLA, or managed observability
systems.

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
Streaming support is limited to provider-adapter parsing, safety classification,
and fallback guards; high-level agent event orchestration remains the caller's
responsibility.

Capability negotiation is per-attempt. Each provider attempt gets the strongest
requested capability set that provider supports. If fallback moves to another
provider, that next attempt is negotiated again and may use a reduced capability
set, such as dropping `zeroDataRetention` while keeping
`disallowPromptTraining`. Telemetry records unsupported drops per provider
attempt with the canonical `modelId`, `providerId`, dropped capability, reason,
and attempt index; `capability_negotiated` records the actual capability set used
for each attempt.

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
not full historical aggregation, and suggestion tools do not edit YAML policies.
When JSONL telemetry is enabled, suggestions can read from the local JSONL file
through the same bounded query path.

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

### `get_harness_stats`

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "dev-session-1",
  "limit": 100
}
```

The result is based on the configured telemetry sink and the latest bounded
window only.

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

`record_eval_event` is for local harness notes and telemetry only. It is not a
full eval platform, experiment tracker, dashboard, or research pipeline manager.
Broad eval and research workflow management is out of scope for this harness.

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

## Release hygiene

This candidate is prepared for the `v1.0.0-candidate.7` prerelease line. Before
publishing to npm, verify that `package.json`, `package-lock.json`, and the git
tag use the same candidate version. Do not publish automatically from this
repository; run `npm test` and `npm run build` before any manual publish.

Candidate.7 release notes:

- Folds candidate.5 per-attempt capability negotiation and candidate.6 responsibility-boundary hardening into one release candidate.
- Capability negotiation is now per-provider-attempt.
- Primary providers keep capabilities that only fallback providers lack.
- Fallback attempts recompute requested capabilities independently.
- Keeps unsupported capability drops independent for `zeroDataRetention`, `disallowPromptTraining`, and `thinking`.
- Preserves the DeepSeek v4 Pro `providerTwo` thinking override without affecting other providers or models.
- Adds provider-aware `capability_dropped` telemetry with reason and attempt index metadata.
- Adds `capability_negotiated` telemetry for the actual capability set used per attempt.
- Documents that this is a model/provider-aware harness, not an IDE, coding agent, provider gateway, observability product, billing system, workspace indexer, secret manager, or eval platform.
- Clarifies that IDEs and coding agents own context selection.
- Clarifies that `compact_context` is only a model-aware context budget guard.
- Clarifies that telemetry and stats are local harness health tools, not billing or SLA observability.
- Clarifies that `repair_tool_input` is a repair utility, not a general external tool registry.
- Clarifies that provider matrix docs are manual smoke-test guidance, not automated live-provider coverage.

Candidate.4 release notes:

- Adds optional JSONL telemetry via `OSS_HARNESS_TELEMETRY_SINK=memory|jsonl`.
- Keeps memory telemetry as the default sink.
- Uses `OSS_HARNESS_TELEMETRY_JSONL_PATH` as the required local file path when JSONL is enabled.
- JSONL writes sanitized telemetry events only, one event per line.
- Raw `sessionId` is replaced by `sessionIdHash`.
- `query_telemetry`, `get_harness_stats`, and `suggest_repair_policy` work with memory and JSONL sinks.
- Missing or empty JSONL files return empty telemetry results safely.
- Malformed JSONL lines are skipped safely.

Candidate.4 caveats:

- JSONL is local debug/audit telemetry, not managed observability.
- JSONL reads currently read the full file before applying bounded returned-window limits.
- Malformed JSONL lines are skipped silently.
- No rotation, file locking, or multi-process write coordination is included.
- Configured JSONL files should be treated as internal telemetry files, not arbitrary trusted import files.
