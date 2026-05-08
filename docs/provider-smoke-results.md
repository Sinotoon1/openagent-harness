# Provider Smoke Results

Version: `v1.0.0-candidate.20`

These notes document the current real-provider findings for local internal smoke
testing. Provider config is loaded through `OSS_HARNESS_PROVIDER_CONFIG_PATH`
when set, so testers should validate the same local provider YAML they intend to
run through MCP.

`deepseekPrimary` uses these runtime environment variables:

- `DEEPSEEK_PRIMARY_BASE_URL`
- `DEEPSEEK_PRIMARY_API_KEY`

API keys are runtime secrets. Do not put real key values in YAML, docs, test
fixtures, screenshots, JSONL samples, or issue comments.

## Current Findings

| Finding | Result |
|---|---|
| Provider config loaded through `OSS_HARNESS_PROVIDER_CONFIG_PATH` | Pass |
| `deepseek-v4-pro` normal call on `deepseekPrimary` | Pass |
| `deepseek-v4-pro` streaming call on `deepseekPrimary` | Pass |
| `rawProviderResponsePreview` with `includeRawProviderResponse=true` | Pass, sanitized and bounded |
| Request-time thinking on `deepseekPrimary` | Unsupported; dropped by capability negotiation when configured as unsupported, or HTTP 400 if a provider config/policy path sends it |
| `kimi-k2-6` on `deepseekPrimary` | Not mapped |
| `deepseek-v4-flash` | Canonical model ID exists, but DeepSeek primary behavior is not verified unless a working slug is configured |
| Unsupported unmapped models | Should fail as `No configured provider supports <modelId>` instead of reaching the provider and returning HTTP 400 |

## Provider Matrix

| providerId | Env vars | Canonical modelId | Provider slug | Normal chat | Streaming | Thinking | Fallback | Telemetry | Status |
|---|---|---|---|---|---|---|---|---|---|
| `deepseekPrimary` | `DEEPSEEK_PRIMARY_BASE_URL`, `DEEPSEEK_PRIMARY_API_KEY` | `deepseek-v4-pro` | `deepseek-v4-pro` or `DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG` | Pass | Pass | Unsupported; should be dropped | Not primary fallback target in local smoke | Capability and provider attempt telemetry expected | Verified locally |
| `deepseekPrimary` | `DEEPSEEK_PRIMARY_BASE_URL`, `DEEPSEEK_PRIMARY_API_KEY` | `kimi-k2-6` | Not mapped | Not run | Not run | Not applicable | Not applicable | Clear unsupported-model error expected | Intentionally unsupported |
| `deepseekPrimary` | `DEEPSEEK_PRIMARY_BASE_URL`, `DEEPSEEK_PRIMARY_API_KEY` | `deepseek-v4-flash` | Optional `DEEPSEEK_PRIMARY_DEEPSEEK_V4_FLASH_SLUG` only if local config adds it | Not verified | Not verified | Unknown until verified | Not verified | Telemetry expected if tested | Canonical but unverified |
| `openrouterFallback` | `OPENROUTER_FALLBACK_BASE_URL`, `OPENROUTER_FALLBACK_API_KEY` | `kimi-k2-6`, `deepseek-v4-pro`, `deepseek-v4-flash` | Configured `OPENROUTER_FALLBACK_*_SLUG` or defaults | Not verified in this note | Not verified in this note | Provider-specific | Verify before-first-token fallback only | Fallback and capability telemetry expected | Placeholder until configured |

## Smoke Procedure

1. Copy `examples/providers.local.example.yaml` to a local ignored path.
2. Set `OSS_HARNESS_PROVIDER_CONFIG_PATH` to that file.
3. Set provider base URL and API key environment variables in the MCP client
   environment, not in YAML.
4. Run `npm run build`.
5. Start the MCP server through the client under test.
6. Call `oss_chat` with `deepseek-v4-pro`, `providerPriority:
   ["deepseekPrimary"]`, and a stable smoke `sessionId`.
7. Repeat with `streaming: { "enabled": true }`.
8. Repeat with `includeRawProviderResponse: true` and confirm
   `rawProviderResponsePreview` does not expose prompts, messages, headers, env
   values, API keys, or raw provider response containers.
9. Call an intentionally unmapped model/provider combination and confirm the
   error is `No configured provider supports <modelId>`.
10. Query telemetry and confirm events are sanitized and session IDs are hashed.

## Interpreting Failures

`No configured provider supports <modelId>` means no enabled provider has a
mapping for that canonical model ID. A provider is enabled only when its
configured `baseUrlEnv` has a value.

`HTTP 400 before_first_token` means the provider was reached but rejected the
provider-native model slug, capability flags, or request shape before assistant
output began.

If an unsupported model returns provider HTTP 400, the provider config likely
advertises a mapping that should remain absent until the provider slug is
verified.
