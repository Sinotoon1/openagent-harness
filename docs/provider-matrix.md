# Provider Matrix and Manual Smoke Tests

The harness uses logical provider IDs, not provider account names. In
`v1.0.0-candidate.18`, `providerOne` was renamed to `deepseekPrimary` and the
fallback placeholder was renamed to `openrouterFallback`. Broad compatibility
aliases are intentionally not kept during this candidate-stage cleanup.

The current provider adapter expects OpenAI-compatible `/chat/completions`
semantics. Bundled provider config is used unless
`OSS_HARNESS_PROVIDER_CONFIG_PATH` points at a local replacement YAML file. Run
`npm run build` before testing a packaged `dist/server.js` because the build
copies `src/providers/providers.yaml` into `dist/providers/providers.yaml`.

## Matrix

| Provider ID | Base URL env | Auth env | Session pin header | Strategy | Advertised model mappings | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `deepseekPrimary` | `DEEPSEEK_PRIMARY_BASE_URL` | `DEEPSEEK_PRIMARY_API_KEY` | `X-Session-Id` | `raw` | `deepseek-v4-pro` | Verified locally for normal and streaming chat. Request-time thinking is unsupported and is not sent. |
| `openrouterFallback` | `OPENROUTER_FALLBACK_BASE_URL` | `OPENROUTER_FALLBACK_API_KEY` | `X-Routing-Key` | `hash` | `kimi-k2-6`, `deepseek-v4-pro`, `deepseek-v4-flash` | Placeholder fallback mapping until configured and verified. |

`deepseekPrimary` does not map `kimi-k2-6` because local smoke testing showed the
provider rejects that model with HTTP 400. It also does not map
`deepseek-v4-flash` until a provider slug is verified. `No configured provider
supports <modelId>` means no enabled provider has a mapping for that canonical
model. HTTP 400 means a provider was reached but rejected the model slug,
capability, or request shape.

## Manual Smoke-Test Setup

Use a disposable session ID so session pinning and cache telemetry are easy to
identify:

```bash
export DEEPSEEK_PRIMARY_BASE_URL=https://deepseek-primary.example/v1
export DEEPSEEK_PRIMARY_API_KEY=...
export OPENROUTER_FALLBACK_BASE_URL=https://openrouter-fallback.example/v1
export OPENROUTER_FALLBACK_API_KEY=...
npm run build
node dist/server.js
```

API keys are runtime secrets. They are not required for unit tests and should not
be committed to config files, test fixtures, snapshots, or logs.

## Local Smoke Result Notes

- `deepseek-v4-pro` normal chat on `deepseekPrimary`: pass.
- `deepseek-v4-pro` streaming chat on `deepseekPrimary`: pass.
- `deepseek-v4-pro` request-time thinking on `deepseekPrimary`: HTTP 400; the
  provider capability is therefore `thinking: false`.
- `kimi-k2-6` on `deepseekPrimary`: unsupported.
- `deepseek-v4-flash`: canonical ID is recognized, but `deepseekPrimary` does
  not advertise it until a working slug is verified.

## Manual Smoke Tests

These are manual live-provider smoke-test procedures. They are not automated
live-provider integration coverage, and the unit test suite does not require
real provider credentials or network access.

### Non-Streaming Chat

Call `oss_chat` with `streaming.enabled` omitted or `false`:

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "provider-smoke-1",
  "messages": [{ "role": "user", "content": "Reply with one short sentence." }],
  "providerPriority": ["deepseekPrimary"]
}
```

Expected result: one provider attempt, `content` contains the assistant response,
and the provider request body contains `"stream": false`.

### Streaming Chat

Call `oss_chat` with streaming enabled:

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "provider-smoke-2",
  "messages": [{ "role": "user", "content": "Reply with two words." }],
  "providerPriority": ["deepseekPrimary"],
  "streaming": { "enabled": true }
}
```

Expected result: the provider request uses SSE streaming, while the MCP response
returns the final collected text after the provider stream completes. If the
stream contains OpenAI-compatible tool-call deltas, the response includes
reconstructed `toolCalls`; raw deltas remain hidden by default and are available
only inside the opt-in sanitized raw provider preview.

### Session Pin Header

Repeat either chat request with the same `sessionId`. Inspect the outgoing
provider HTTP request:

- `deepseekPrimary` should send `X-Session-Id` with the raw session ID.
- `openrouterFallback` should send `X-Routing-Key` with a stable hash, not the raw
  session ID.

### Fallback Before First Token

Configure `providerPriority` with a deliberately failing first provider and a
healthy second provider:

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "provider-smoke-fallback",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["deepseekPrimary", "openrouterFallback"],
  "streaming": { "enabled": true }
}
```

Expected result: fallback occurs only if the first provider fails before
meaningful assistant output. After meaningful output, the router must not switch
providers.

### Capability Negotiation

Request all capabilities against `deepseekPrimary`:

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "provider-smoke-capabilities",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["deepseekPrimary"],
  "capabilities": {
    "zeroDataRetention": true,
    "disallowPromptTraining": true,
    "thinking": true
  }
}
```

Expected result: `thinking` is dropped for `deepseekPrimary`, the provider
request does not include request-time thinking, and capability telemetry records
the dropped capability with provider ID and attempt index.

### Model Slug Translation

Set a slug override, then send a request using the canonical model ID:

```bash
export DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG=provider-native-deepseek-pro-slug
```

```json
{
  "modelId": "deepseek-v4-pro",
  "sessionId": "provider-smoke-slug",
  "messages": [{ "role": "user", "content": "Say ok." }],
  "providerPriority": ["deepseekPrimary"]
}
```

Expected result: MCP input and router output keep the canonical model ID, while
the provider HTTP request body uses the provider-native slug.
