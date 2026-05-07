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

In short, the harness owns model/provider-aware policy; provider account
management and live credential validation remain out of scope, and this is not a
provider gateway or eval platform.

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

- broader model policy validation
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
- policy-backed DeepSeek thinking override
- model policy inspection
- effective-context compaction
- telemetry query/report tools
- OpenAI-compatible SSE streaming
- fallback only before first meaningful output

## Tools

- `oss_chat`: routes chat through canonical model IDs, provider priority, retryable fallback, capability negotiation, session pinning, and provider/model overrides.
- `repair_tool_input`: validates first, repairs only after validation fails, then validates again; it is not a general external tool registry.
- `compact_context`: compacts against effective context tokens, never advertised context.
- `get_model_policy`: returns YAML-backed policy for one or all canonical models.
- `inspect_model_policies`: returns sanitized, read-only policy summaries with validation warnings; it does not edit policy YAML.
- `run_policy_doctor`: returns a sanitized, read-only policy and harness health report; it does not edit YAML, auto-apply suggestions, or perform live provider/account/credential validation.
- `record_eval_event`: records local harness notes/telemetry only, not full eval-platform or experiment-tracker state.
- `query_telemetry`: queries configured local harness telemetry with bounded, redacted metadata.
- `get_harness_stats`: summarizes recent sanitized harness health telemetry, not billing or SLA observability.
- `suggest_repair_policy`: suggests repair policy order and reviewable YAML patch previews from repair telemetry without editing YAML.

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

## Model policy

Model policies live in `src/policies/*.yaml` and are copied to `dist/policies`
during build. They define model-aware repair order, effective context tokens, and
narrow provider-specific overrides for known model/provider quirks. This is the
harness-owned model/provider-aware policy layer; provider account management and
live credential validation remain out of scope.

Use `inspect_model_policies` to inspect the loaded model policies through MCP
without exposing provider credentials or editing YAML. The tool can list all
policies or filter by `modelId`, and callers can include or hide repairs,
context, provider overrides, and warnings. Policy inspection is meant to make
model-specific harness behavior easier to update in YAML/config without changing
TypeScript logic. It does not auto-apply suggestions, validate live provider
accounts, or add eval-platform behavior.

Use `run_policy_doctor` for a read-only harness health check across loaded model
policies, static provider config, provider overrides, repair names, context
settings, and telemetry-driven repair suggestions. The doctor returns a
structured `status`, summary counts, and severity-filterable issues. It does not
write policy YAML, provider config, telemetry, package, or generated files; it
does not auto-apply policy suggestions; and it does not perform live provider,
account, quota, credential, or base URL validation.

Example:

```json
{
  "modelId": "deepseek-v4-pro",
  "includeTelemetry": true,
  "includeProviderConfig": true,
  "includeSuggestions": true,
  "severity": "warning"
}
```

Provider overrides intentionally support only a small capability policy shape:

```yaml
providerOverrides:
  - providerId: providerTwo
    thinking: disabled
    reason: deepseek-v4-pro on providerTwo must run with thinking disabled
```

`thinking` may be `enabled`, `disabled`, or `unchanged`. For example,
`deepseek-v4-pro` disables `thinking` only on `providerTwo`; `providerOne`,
other DeepSeek models, and Kimi are unaffected. Unsupported capability flags are
still omitted from provider requests, and `capability_dropped` /
`thinking_overridden` telemetry remains provider-attempt aware.

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
harness, not a general tool registry. External IDE/tool schema ownership remains
with the caller. For external tools, callers should pass a `schemaDescriptor` to
`repair_tool_input` instead of expecting this harness to grow hard-coded schemas
indefinitely.

Caller-provided repair schema descriptors are intentionally small. They support
`toolName`, a `schema` tree with `string`, `number`, `boolean`, `array`, and
`object` nodes, object `properties`, optional `required` arrays, optional node
flags, and top-level `pathStringFields` / `pathStringArrayFields` for markdown
path auto-link repair. Descriptors are bounded by field count, repair path count,
repair path depth, and schema nesting depth. They drive validation and repair
only; semantic normalization remains separate and currently applies only to
explicit built-in normalization such as `readFile` relational defaults.
Descriptor field names and configured paths must not contain dangerous object
keys: `__proto__`, `prototype`, or `constructor`.

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

`suggest_repair_policy` also returns `policySuggestions`, a reviewable policy
patch suggestion section. Each suggestion includes current repairs when the
model policy can be loaded, frequency-ordered suggested repairs, simple
confidence, warnings, and a YAML preview for a human to review. The harness never
auto-applies policy changes, never writes policy files, and does not add a policy
apply tool. Humans must manually review and edit `src/policies/*.yaml`.

Confidence is a small operational heuristic, not a statistical guarantee:

- `low`: fewer than 10 repaired events for the model.
- `medium`: 10-49 repaired events for the model.
- `high`: 50 or more repaired events for the model.

Warnings call out insufficient telemetry, unknown repair names, missing policies,
already-aligned ordering, the bounded latest-window limitation, and whether
telemetry may be memory or JSONL depending on configuration.

When `suggest_repair_policy` is called with an explicit `modelId` and that model
has zero repaired telemetry events in the bounded latest window, the response
includes one `policySuggestions` row with `status: "insufficient_data"`,
`confidence: "low"`, `eventCount: 0`, empty `suggestedRepairs`, and
`yamlPatchPreview: null`. If the policy exists, the row still includes
`currentRepairs`; if it cannot be loaded, the row includes a missing-policy
warning instead of failing. Calls without `modelId` remain telemetry-driven and
do not emit zero-event rows for every known policy. Use an explicit `modelId` to
check whether a model has enough repair telemetry to review.

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

### `repair_tool_input` with caller schema descriptor

```json
{
  "modelId": "deepseek-v4-pro",
  "schemaDescriptor": {
    "toolName": "callerPathBatch",
    "schema": {
      "type": "object",
      "properties": {
        "paths": {
          "type": "array",
          "items": { "type": "string" }
        },
        "label": { "type": "string", "optional": true }
      },
      "required": ["paths"]
    },
    "pathStringArrayFields": ["paths"]
  },
  "input": {
    "paths": "[src/a.ts](src/a.ts)"
  }
}
```

The caller owns the external tool schema and tool execution. The harness only
validates model-produced input against the descriptor, applies enabled
model-aware repairs, and returns a sanitized repair result.

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

Example response excerpt:

```json
{
  "policySuggestions": [
    {
      "modelId": "deepseek-v4-pro",
      "kind": "repair_order",
      "status": "suggested",
      "confidence": "low",
      "window": { "type": "latest", "limit": 200, "eventCount": 4 },
      "currentRepairs": ["parseJsonArrayString", "bareStringToArray"],
      "suggestedRepairs": ["bareStringToArray", "parseJsonArrayString"],
      "yamlPatchPreview": "# Suggestion only; review manually before editing YAML.\nrepairs:\n  - bareStringToArray\n  - parseJsonArrayString"
    }
  ],
  "note": "No YAML policies were modified."
}
```

Zero-event response excerpt for an explicit model:

```json
{
  "policySuggestions": [
    {
      "modelId": "deepseek-flash",
      "kind": "repair_order",
      "status": "insufficient_data",
      "confidence": "low",
      "window": { "type": "latest", "limit": 200, "eventCount": 0 },
      "currentRepairs": ["markdownPathAutolinkUnwrap", "parseJsonArrayString"],
      "suggestedRepairs": [],
      "yamlPatchPreview": null
    }
  ],
  "note": "No YAML policies were modified."
}
```

### `get_model_policy`

```json
{
  "modelId": "deepseek-flash"
}
```

### `inspect_model_policies`

`inspect_model_policies` is read-only. It reports loaded model policy summaries
and validation warnings; it does not edit YAML or apply policy suggestions.

```json
{
  "modelId": "deepseek-v4-pro",
  "includeRepairs": true,
  "includeContext": true,
  "includeOverrides": true,
  "includeWarnings": true
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

This candidate is prepared for the `v1.0.0-candidate.14` prerelease line. Before
publishing to npm, verify that `package.json`, `package-lock.json`, and the git
tag use the same candidate version. Do not publish automatically from this
repository; run `npm test` and `npm run build` before any manual publish.

Candidate.14 release notes:

- Adds the read-only `run_policy_doctor` MCP tool for policy, provider config, provider override, context, and telemetry suggestion consistency checks.
- Returns sanitized structured reports with `ok`, `warning`, or `error` status, summary counts, and severity-filterable issues.
- Reports missing provider base URL environment values as info-level disabled-provider caveats, not credential or account validation.
- Keeps policy suggestions review-only: no YAML, provider config, telemetry, package, or generated files are written and no apply tool is added.
- Preserves repair behavior, provider routing, streaming, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, policy loading, provider config behavior, MCP tool names, and caller-provided schema descriptor behavior.

Candidate.13 release notes:

- Adds explicit `insufficient_data` policy suggestion rows for requested models with zero repaired telemetry.
- Includes current repairs for zero-event rows when the model policy exists.
- Keeps all-model `suggest_repair_policy` calls telemetry-driven, without emitting zero-event rows for every policy.
- Keeps YAML patch previews null for zero-event rows and preserves the no-auto-apply boundary.

Candidate.12 release notes:

- Extends `suggest_repair_policy` with reviewable `policySuggestions`.
- Adds frequency-ordered repair suggestions, current policy order, confidence, warnings, and YAML patch previews.
- Keeps the existing `suggestions` output for compatibility.
- Documents confidence as a simple latest-window heuristic, not a statistical guarantee.
- Keeps policy editing human-owned: no YAML files are written and no policy apply tool is added.

Candidate.11 release notes:

- Adds the read-only `inspect_model_policies` MCP tool.
- Returns sanitized policy summaries with repairs, effective context tokens, provider overrides, warnings, and validation status.
- Supports include flags for providers, repairs, context, overrides, and warnings.
- Adds policy inspection warnings for unknown provider overrides, duplicate overrides, empty repairs, missing context tokens, unordered context thresholds, unknown repairs, and no-op overrides.
- Keeps policy inspection non-editing and preserves the boundary that provider account management and eval-platform behavior are out of scope.

Candidate.10 release notes:

- Externalizes the `deepseek-v4-pro` + `providerTwo` thinking override into model policy YAML.
- Adds narrow provider-specific policy overrides with `providerId`, `thinking`, and optional `reason`.
- Applies model/provider policy overrides immediately after per-attempt capability negotiation.
- Keeps unsupported capability drops, `thinking_overridden` telemetry, JSONL telemetry handling, and MCP tool names intact without renaming or removing existing response fields.
- Documents policy-backed model/provider quirks while preserving the boundary that this is not a provider gateway or eval platform.

Candidate.9 release notes:

- Rejects caller-provided repair schema descriptor object keys and path entries containing `__proto__`, `prototype`, or `constructor`.
- Applies dangerous-key checks to nested descriptor object fields, `required` field references, `pathStringFields`, and `pathStringArrayFields`.
- Preserves normal safe field names, caller-provided descriptor repair behavior, and built-in repair schemas.
- Keeps invalid descriptor responses structured and model-readable without echoing raw inputs or secrets.

Candidate.8 release notes:

- Adds caller-provided `repair_tool_input.schemaDescriptor` support for external tool input repair.
- Keeps built-in repair schemas for backward compatibility.
- Builds bounded runtime validators from a small JSON-schema-like descriptor subset.
- Preserves validate-then-repair, valid-input zero-touch, issue-path precise repair, and existing repair order.
- Keeps repair and semantic normalization separate; caller descriptors do not add relational defaults.
- Rejects invalid, oversized, or too-deep descriptors with structured issues and a model-readable retry message.
- Documents that callers own external tool schemas and execution; this harness remains a narrow model-aware repair utility, not a tool registry.

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
