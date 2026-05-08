# MCP Local Smoke Test Results

Version: `v1.0.0-candidate.18`

Summary: 9/10 passed.

The earlier `oss_chat` real provider smoke test was blocked because provider
environment variables and credentials were not configured. With candidate.18,
`DEEPSEEK_PRIMARY_BASE_URL` and `DEEPSEEK_PRIMARY_API_KEY` enable the verified
DeepSeek primary provider. `No configured provider supports <modelId>` means no
enabled provider has a mapping for that canonical model. HTTP 400 means the
provider was reached but rejected the model slug, capability, or request shape.

| # | Smoke Test | Result | Notes |
|---|---|---|---|
| 1 | MCP Inspector lists all 10 tools | Pass | Inspector reported the expected tool surface. |
| 2 | `repair_tool_input` bare string to array | Pass | Repair converted a bare string into the expected array shape. |
| 3 | `repair_tool_input` JSON array string to array | Pass | Repair parsed a JSON array string into an array. |
| 4 | `repair_tool_input` markdown path unwrap | Pass | Repair unwrapped markdown path formatting into a plain path string. |
| 5 | `inspect_model_policies` DeepSeek policy | Pass | DeepSeek policy inspection returned the expected policy details. |
| 6 | `run_policy_doctor` | Pass | Policy doctor returned a structured read-only health report. |
| 7 | `query_telemetry` sanitized events | Pass | Telemetry query returned sanitized event data. |
| 8 | `get_harness_stats` | Pass | Harness stats returned bounded aggregate health data. |
| 9 | `suggest_repair_policy` `insufficient_data` | Pass | Explicit no-data policy suggestion returned `insufficient_data`. |
| 10 | `oss_chat` real provider | Blocked | Provider env vars / credentials were not configured. |

## Provider Smoke Results

| Provider Test | Result | Notes |
|---|---|---|
| `deepseek-v4-pro` normal chat on `deepseekPrimary` | Pass | Provider reached successfully. |
| `deepseek-v4-pro` streaming chat on `deepseekPrimary` | Pass | Provider reached successfully with streaming enabled. |
| `deepseek-v4-pro` request-time thinking on `deepseekPrimary` | HTTP 400 | `thinking` capability is now false for `deepseekPrimary`. |
| `kimi-k2-6` on `deepseekPrimary` | Unsupported | Local smoke showed HTTP 400, so this mapping is not advertised. |
| `deepseek-v4-flash` on `deepseekPrimary` | Not supported | Canonical ID exists, but no DeepSeek primary slug is advertised until verified. |

## Next Provider Matrix Smoke Tests

These provider-backed checks still require configured provider base URLs and
credentials:

- Non-streaming chat.
- Streaming chat.
- Session pin header.
- Before-first-token fallback.
- After-first-token no fallback.
- Capability negotiation.
- JSONL telemetry.
