# Provider Matrix and Manual Smoke Tests

This harness ships with two placeholder provider IDs: `providerOne` and
`providerTwo`. They become real providers only when `src/providers/providers.yaml`
points at the correct environment variable names and those environment variables
are set for an OpenAI-compatible service.

The current provider adapter expects OpenAI-compatible `/chat/completions`
semantics. Run `npm run build` before testing a packaged `dist/server.js` because
the build copies `src/providers/providers.yaml` into `dist/providers/providers.yaml`.

## Matrix

| Provider ID | Base URL env | Auth env | Session pin header | Strategy | Notes |
| --- | --- | --- | --- | --- | --- |
| `providerOne` | `PROVIDER_ONE_BASE_URL` | `PROVIDER_ONE_API_KEY` | `X-Session-Id` | `raw` | Placeholder until configured. |
| `providerTwo` | `PROVIDER_TWO_BASE_URL` | `PROVIDER_TWO_API_KEY` | `X-Routing-Key` | `hash` | Placeholder until configured. |

Model slug defaults are identity mappings for `kimi-k2-6`, `deepseek-v4-pro`, and
`deepseek-flash`. Override them with the `*_SLUG` environment variables listed in
`README.md` when a provider uses different model names.

## Manual Smoke-Test Setup

Use a disposable session ID so session pinning and cache telemetry are easy to
identify:

```bash
export PROVIDER_ONE_BASE_URL=https://provider-one.example/v1
export PROVIDER_ONE_API_KEY=...
export PROVIDER_TWO_BASE_URL=https://provider-two.example/v1
export PROVIDER_TWO_API_KEY=...
npm run build
node dist/server.js
```

API keys are runtime secrets. They are not required for unit tests and should not
be committed to config files, test fixtures, snapshots, or logs.

## Manual Smoke Tests

These are manual live-provider smoke-test procedures. They are not automated
live-provider integration coverage, and the unit test suite does not require
real provider credentials or network access.

### Non-Streaming Chat

Call `oss_chat` with `streaming.enabled` omitted or `false`:

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "provider-smoke-1",
  "messages": [{ "role": "user", "content": "Reply with one short sentence." }],
  "providerPriority": ["providerOne"]
}
```

Expected result: one provider attempt, `content` contains the assistant response,
and the provider request body contains `"stream": false`.

### Streaming Chat

Call `oss_chat` with streaming enabled:

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "provider-smoke-2",
  "messages": [{ "role": "user", "content": "Reply with two words." }],
  "providerPriority": ["providerOne"],
  "streaming": { "enabled": true }
}
```

Expected result: the provider request uses SSE streaming, while the MCP response
returns the final collected text after the provider stream completes. Tool-call
deltas remain raw deltas in `raw.toolCallDeltas`.

### Session Pin Header

Repeat either chat request with the same `sessionId`. Inspect the outgoing
provider HTTP request:

- `providerOne` should send `X-Session-Id` with the raw session ID.
- `providerTwo` should send `X-Routing-Key` with a stable hash, not the raw
  session ID.

### Fallback Before First Token

Configure `providerPriority` with a deliberately failing first provider and a
healthy second provider:

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "provider-smoke-fallback",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["providerOne", "providerTwo"],
  "streaming": { "enabled": true }
}
```

Expected result: fallback occurs only if the first provider fails before
meaningful assistant output. After meaningful output, the router must not switch
providers.

### Capability Negotiation

Request all capabilities against both providers:

```json
{
  "modelId": "deepseek-flash",
  "sessionId": "provider-smoke-capabilities",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["providerOne", "providerTwo"],
  "capabilities": {
    "zeroDataRetention": true,
    "disallowPromptTraining": true,
    "thinking": true
  }
}
```

Expected result: each provider attempt uses the strongest capability set that
provider supports. Unsupported flags are dropped independently for that attempt,
listed in `droppedCapabilities` for the successful attempt, and recorded in
capability telemetry with the provider ID and attempt index.

### Model Slug Translation

Set a slug override, then send a request using the canonical model ID:

```bash
export PROVIDER_ONE_KIMI_K2_6_SLUG=provider-native-kimi-slug
```

```json
{
  "modelId": "kimi-k2-6",
  "sessionId": "provider-smoke-slug",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["providerOne"]
}
```

Expected result: MCP input and router output keep the canonical model ID, while
the provider HTTP request body uses the provider-native slug.
