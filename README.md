# oss-agent-harness-mcp

TypeScript MCP server exposing an OSS coding-agent harness over stdio.

This project is a **v1 candidate**. It is not yet a production-ready v1 release.
Use [docs/production-ready-checklist.md](docs/production-ready-checklist.md) and
[docs/release-readiness-audit.md](docs/release-readiness-audit.md) before making a
production-ready v1 decision.

The tool logic is transport-neutral: `src/server.ts` only wires stdio, while
tools, routing, repair, context compaction, telemetry, policies, and providers
live in separate modules so Streamable HTTP can be added later without changing
tool logic.

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

## Tools

- `oss_chat`: routes chat through canonical model IDs, provider priority, retryable fallback, capability negotiation, session pinning, and provider/model overrides.
- `repair_tool_input`: validates first, repairs only after validation fails, then validates again; it is not a general external tool registry.
- `compact_context`: compacts against effective context tokens, never advertised context.
- `get_model_policy`: returns YAML-backed policy for one or all canonical models.
- `record_eval_event`: records local harness notes/telemetry only, not full eval-platform or experiment-tracker state.
- `query_telemetry`: queries configured local harness telemetry with bounded, redacted metadata.
- `get_harness_stats`: summarizes recent sanitized harness health telemetry, not billing or SLA observability.
- `suggest_repair_policy`: suggests repair policy order and reviewable YAML patch previews from repair telemetry without editing YAML.
- `inspect_model_policies`: returns sanitized, read-only policy summaries with validation warnings; it does not edit policy YAML.
- `run_policy_doctor`: returns a sanitized, read-only policy and harness health report; it does not edit YAML, auto-apply suggestions, or perform live provider/account/credential validation.

Canonical model IDs:

- `kimi-k2-6`
- `deepseek-v4-pro`
- `deepseek-flash`

## Configuration

Both providers are OpenAI-compatible HTTP adapters in this candidate. Provider
IDs are placeholders until their environment variables point at real
OpenAI-compatible services.

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

Provider metadata lives in `src/providers/providers.yaml` and is copied to
`dist/providers/providers.yaml` during build. Model policies live in
`src/policies/*.yaml` and are copied to `dist/policies` during build.

See [docs/provider-matrix.md](docs/provider-matrix.md) for manual provider
smoke-test guidance.

## Usage Examples

### `oss_chat`

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "dev-session-1",
  "messages": [{ "role": "user", "content": "Summarize this change." }],
  "providerPriority": ["providerOne", "providerTwo"],
  "capabilities": { "zeroDataRetention": true }
}
```

Successful `oss_chat` responses are shaped by default: they include the model
output and safe routing metadata, but not the full raw provider payload. Set
`includeRawProviderResponse: true` only for debugging; the returned
`rawProviderResponsePreview` uses stricter provider-preview sanitization and is
bounded, not an unbounded provider response dump. Raw/debug containers such as
`raw`, `data`, `response`, and `debug` are summarized rather than returned.

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

### `run_policy_doctor`

```json
{
  "modelId": "deepseek-v4-pro",
  "includeTelemetry": true,
  "includeProviderConfig": true,
  "includeSuggestions": true,
  "severity": "warning"
}
```

More operational behavior and examples are documented in
[docs/runtime-behavior.md](docs/runtime-behavior.md).

## Development

```bash
npm install
npm test
npm run build
```

Run with stdio during development:

```bash
npm run dev
```

Or after building:

```bash
node dist/server.js
```

MCP client examples for Codex CLI, Claude Code, VS Code, and OpenCode are in
[docs/mcp-client-examples.md](docs/mcp-client-examples.md).

## Packaging

This package exposes the `oss-agent-harness-mcp` bin at `dist/server.js`.
Published packages should include built `dist`, copied policy YAML, copied
provider config YAML, `README.md`, `CHANGELOG.md`, and useful docs. Do not
publish directly from this repository without running:

```bash
npm test
npm run build
npm pack --dry-run
```

See [CHANGELOG.md](CHANGELOG.md) for candidate release history.
