# Runtime Behavior Notes

This document holds operational detail that should stay out of the short README.
The project remains a v1 candidate until the production-ready checklist is met.

## Model Policy

Model policies live in `src/policies/*.yaml` and are copied to `dist/policies`
during build. They define model-aware repair order, effective context tokens, and
narrow provider-specific overrides for known model/provider quirks.

Use `inspect_model_policies` to inspect loaded model policies through MCP
without exposing provider credentials or editing YAML. It can list all policies
or filter by `modelId`, and callers can include or hide repairs, context,
provider overrides, and warnings.

Use `run_policy_doctor` for a read-only harness health check across loaded model
policies, static provider config, provider overrides, repair names, context
settings, and telemetry-driven repair suggestions. The doctor returns a
structured `status`, summary counts, and severity-filterable issues. It does not
write policy YAML, provider config, telemetry, package, or generated files; it
does not auto-apply policy suggestions; and it does not perform live provider,
account, quota, credential, or base URL validation.

Provider overrides intentionally support only a small capability policy shape:

```yaml
providerOverrides:
  - providerId: deepseekPrimary
    thinking: disabled
    reason: deepseek-v4-pro on deepseekPrimary must run with thinking disabled
```

`thinking` may be `enabled`, `disabled`, or `unchanged`. Unsupported capability
flags are still omitted from provider requests, and `capability_dropped` /
`thinking_overridden` telemetry remains provider-attempt aware.

## Repair And Normalization

Tool responses are sanitized before they are serialized back over MCP. Full raw
inputs are not echoed by default. `repair_tool_input` returns flags, repairs,
changed paths, notes, and a `sanitizedOutputPreview`; it does not return raw
`input`, `data`, `repairedInput`, or `normalizedInput` payloads.

Repair and normalization are separate. `repair_tool_input` validates first and
only repairs after schema validation fails; valid input is zero-touch and returns
`repaired=false`. Semantic defaults, such as `readFile` applying `offset = 0`
when only `limit` is present or `limit = 2000` when only `offset` is present,
run through normalization and emit `tool_input_normalized`.

Repairs are issue-path precise. The repair engine iterates over Zod issue paths
and only edits fields reported by validation. Built-in repair schemas are small
compatibility helpers for this harness, not a general tool registry.

Caller-provided repair schema descriptors are intentionally small. They support
`toolName`, a `schema` tree with `string`, `number`, `boolean`, `array`, and
`object` nodes, object `properties`, optional `required` arrays, optional node
flags, and top-level `pathStringFields` / `pathStringArrayFields` for markdown
path auto-link repair. Descriptor field names and configured paths must not
contain dangerous object keys: `__proto__`, `prototype`, or `constructor`.

## Telemetry

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
telemetry sink boundary and again before MCP responses.

Raw top-level `sessionId` values are not stored in telemetry. Sinks store a
deterministic SHA-256 `sessionIdHash` instead, and `query_telemetry` supports
filtering by `sessionId` by hashing the query value before matching. Set
`OSS_HARNESS_TELEMETRY_SALT` in deployments so session hashes are salted; without
a salt they remain deterministic but are easier to compare across environments.

Metadata uses a denylist for risky payload fields. Keys such as `messages`,
`content`, `fileContent`, `fileContents`, `command`, `stdout`, `stderr`,
`headers`, and `env` are summarized instead of returned raw. `query_telemetry`
never returns raw metadata; even with `includeMetadata=true`, metadata is the
bounded and sanitized form.

`get_harness_stats` returns aggregate counts over the bounded latest telemetry
window using the same telemetry query path as `query_telemetry`. These stats are
local harness health aids, not usage analytics, billing, quota, SLA, or managed
observability systems.

## Streaming And Capabilities

The OpenAI-compatible provider adapter supports OpenAI-style SSE streaming when
`streaming.enabled=true`, while preserving the non-streaming `stream=false` path.
Retryable provider failures may fallback only before first meaningful assistant
output. After content deltas or tool-call deltas begin, the router does not
automatically switch providers.

MCP-visible provider errors are sanitized diagnostics only. HTTP failures report
safe fields such as provider ID, status, fallback phase, and retryability; raw
provider response bodies are not included in tool responses or fallback
telemetry.

Successful `oss_chat` responses are shaped by default. They return the collected
model text plus safe metadata such as model ID, provider ID, negotiated
capabilities, dropped capabilities, fallback attempts, usage, and finish reason
when available. They do not include the full raw provider payload unless the
caller explicitly sets `includeRawProviderResponse: true`.

When raw provider visibility is requested, the response includes
`rawProviderResponsePreview` rather than an unbounded raw payload. The preview is
sanitized with stricter provider-preview rules and bounded for object depth,
array length, object keys, and string length. Risky fields such as prompts,
messages, content, headers, env, commands, stdout/stderr, and file contents are
summarized or redacted. Provider raw/debug containers named `raw`, `data`,
`response`, or `debug` are also summarized instead of traversed or returned.

Remaining candidate caveats:

- MCP tool responses return collected final text after the provider stream completes rather than incremental MCP streaming.
- Tool-call deltas are collected as raw provider deltas inside the opt-in sanitized `rawProviderResponsePreview`; they are not reconstructed into high-level tool calls yet.
- OpenAI-style single-line `data:` JSON chunks are supported; SSE spec-style multi-line `data:` JSON events are not yet supported.

Capability negotiation is per-attempt. Each provider attempt gets the strongest
requested capability set that provider supports. If fallback moves to another
provider, that next attempt is negotiated again and may use a reduced capability
set.

## Context Compaction

Context compaction uses model effective-context policy and heuristic summaries.
It does not yet guarantee that the post-compaction context fits a target token
budget.

## Repair Policy Suggestions

Repair-policy suggestions are based on the bounded latest-200 telemetry window,
not full historical aggregation, and suggestion tools do not edit YAML policies.
When JSONL telemetry is enabled, suggestions can read from the local JSONL file
through the same bounded query path.

`suggest_repair_policy` returns `policySuggestions`, a reviewable policy patch
suggestion section. Each suggestion includes current repairs when the model
policy can be loaded, frequency-ordered suggested repairs, simple confidence,
warnings, and a YAML preview for human review. The harness never auto-applies
policy changes, never writes policy files, and does not add a policy apply tool.

Confidence is a small operational heuristic, not a statistical guarantee:

- `low`: fewer than 10 repaired events for the model.
- `medium`: 10-49 repaired events for the model.
- `high`: 50 or more repaired events for the model.

When `suggest_repair_policy` is called with an explicit `modelId` and that model
has zero repaired telemetry events in the bounded latest window, the response
includes one `policySuggestions` row with `status: "insufficient_data"`,
`confidence: "low"`, `eventCount: 0`, empty `suggestedRepairs`, and
`yamlPatchPreview: null`.
