## oss-agent-harness-mcp v1.0.0-candidate.17

This candidate release shapes successful `oss_chat` responses so raw provider
payloads are hidden by default while preserving explicit debug visibility.

### Changed

- `oss_chat` success responses now return collected model content and safe
  routing metadata by default, without a full `raw` provider payload.
- Added `includeRawProviderResponse`, defaulting to `false`, for explicit debug
  previews.
- Debug previews are returned as `rawProviderResponsePreview` and are sanitized
  and bounded for depth, array length, object keys, and string length.
- Raw/debug provider containers named `raw`, `data`, `response`, or `debug` are
  summarized in debug previews instead of traversed.
- OpenAI-compatible responses now surface safe `usage` and `finishReason`
  metadata when available.

### Preserved

- Provider routing, fallback semantics, streaming parser behavior, telemetry
  semantics, JSONL behavior, repair behavior, context compaction, MCP tool
  names, schema descriptor behavior, policy behavior, and provider request
  behavior are unchanged.
- Raw provider response bodies from HTTP errors remain hidden as in
  candidate.16.

### Validation

- `npm test`: 10 test files passed, 147 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.16

This candidate release fixes MCP-visible provider HTTP error reporting so raw
provider response bodies are not exposed.

### Fixed

- OpenAI-compatible provider HTTP failures no longer read raw response bodies
  into `ProviderError.message`.
- Safe provider diagnostics retain provider ID, HTTP status, fallback phase,
  and retryability for MCP responses and fallback attempts.
- Added regression coverage for non-streaming HTTP errors, streaming setup
  HTTP errors, after-first-token stream failures, prompt-like body text,
  header/env-looking body text, secret-shaped body text, fallback behavior,
  and fallback telemetry.

### Preserved

- Provider routing, fallback semantics, streaming parser behavior, telemetry
  semantics, JSONL behavior, repair behavior, sanitization semantics, context
  compaction, MCP tool names, schema descriptor behavior, and policy behavior
  are unchanged.

### Validation

- `npm test`: 10 test files passed, 142 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.15

This candidate release polishes release documentation and npm packaging metadata for a production-ready v1 decision.

### Changed

- Kept `README.md` concise by moving detailed runtime notes and MCP client examples into `docs/`.
- Added `docs/production-ready-checklist.md` with explicit criteria for a production-ready v1 decision.
- Added `docs/release-readiness-audit.md` with remaining issues classified as blocker, before production-ready v1, candidate caveat, and later.
- Added `CHANGELOG.md` and `docs/` to the npm package `files` list so package dry runs include release history and useful docs.
- Updated package metadata and MCP server advertised version to `1.0.0-candidate.15`.

### Preserved

- No MCP tools were added.
- No production readiness is claimed.
- Repair behavior, provider routing, streaming behavior, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, caller-provided schema descriptors, capability negotiation, policy loading, and policy doctor behavior are unchanged.

### Validation

- `npm test`: 10 test files passed, 133 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 120 files, 71.8 kB package, 344.7 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.14

This candidate release adds a read-only policy doctor / harness health check.

### Added

- New `run_policy_doctor` MCP tool for sanitized policy, provider config, provider override, context, and telemetry suggestion diagnostics.
- Severity-filterable structured reports with `ok`, `warning`, or `error` status and issue summary counts.
- Info-level disabled-provider diagnostics when configured base URL environment variables are absent.
- Telemetry suggestion diagnostics for bounded latest-window caveats, unavailable telemetry, unknown repair names, unapplied suggestions, and suggested repair order mismatches.

### Preserved

- The policy doctor is read-only and does not edit policy YAML, provider config, telemetry, package, or generated files.
- No policy apply tool was added, and repair policy suggestions remain manual review inputs.
- No live provider, account, quota, credential, base URL, or API validation is performed.
- Repair behavior, provider routing, streaming behavior, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, caller-provided schema descriptors, MCP tool names, provider config behavior, and policy loading behavior are unchanged.

### Validation

- `npm test`: 10 test files passed, 133 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.13

This candidate release adds explicit zero-event repair policy suggestion rows.

### Changed

- `suggest_repair_policy` now returns an `insufficient_data` `policySuggestions` row when an explicit `modelId` has zero repaired telemetry events.
- Zero-event rows include current repairs when the model policy can be loaded, empty suggested repairs, low confidence, warnings, and `yamlPatchPreview: null`.
- Calls without `modelId` remain telemetry-driven and do not emit zero-event rows for every known policy.

### Preserved

- Legacy `suggestions` output is unchanged.
- Existing non-zero `policySuggestions` behavior is unchanged.
- Policy suggestions remain review-only; YAML files are not written and no policy apply/write tool is added.
- Repair behavior, provider routing, streaming behavior, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, provider config validation, policy loading, MCP tool names, and caller-provided schema descriptor behavior are unchanged.

### Validation

- `npm test`: 9 test files passed, 115 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.12

This candidate release improves repair policy suggestions into reviewable policy patch suggestions.

### Changed

- `suggest_repair_policy` now returns a `policySuggestions` section alongside the existing `suggestions` output.
- Reviewable suggestions include model ID, repair-order kind, confidence, bounded window, current repairs, suggested repairs, reason, warnings, and a YAML patch preview.
- Suggestions are grouped by model and order known safe repairs by observed frequency in `tool_input_repaired` telemetry.
- Unknown repair names are warned about and excluded from YAML previews.

### Preserved

- `suggest_repair_policy` keeps the same MCP tool name and keeps backward-compatible legacy suggestion fields.
- Policy suggestions are review-only; YAML files are not written and no policy apply/write tool is added.
- Repair behavior, provider routing, streaming behavior, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, provider config validation, policy loading, MCP tool names, and caller-provided schema descriptor behavior are unchanged.

### Validation

- `npm test`: 9 test files passed, 111 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.11

This candidate release adds read-only MCP inspection for model policies.

### Added

- New `inspect_model_policies` MCP tool for sanitized policy summaries.
- Include flags for provider details, repairs, context, provider overrides, and warnings.
- Policy inspection warnings for unknown provider overrides, duplicate overrides, empty repairs, missing effective context tokens, unordered context thresholds, unknown repairs, and no-op overrides.

### Preserved

- Policy inspection does not edit YAML or auto-apply suggestions.
- Provider account management, live credential validation, dashboard behavior, and eval-platform behavior remain out of scope.
- Repair behavior, provider routing behavior, streaming behavior, telemetry sinks, JSONL behavior, security sanitization, session hashing, context compaction, provider config validation, MCP tool names, and caller-provided schema descriptor behavior are unchanged.

### Validation

- `npm test`: 9 test files passed, 104 tests passed.
- `npm run build`: passed.

## oss-agent-harness-mcp v1.0.0-candidate.10

This candidate release externalizes model/provider-specific quirks into model policy configuration.

### Changed

- Moved the DeepSeek v4 Pro + providerTwo thinking override out of hardcoded router/capability logic.
- The override now lives in `src/policies/deepseek-v4-pro.yaml`.
- Provider overrides are loaded through the model policy loader.
- Policy overrides are applied after per-attempt capability negotiation.

### Preserved

- DeepSeek v4 Pro + providerTwo still runs with thinking disabled.
- Other DeepSeek providers are unaffected.
- Other models are unaffected.
- Per-attempt capability negotiation remains unchanged.
- `capability_dropped` telemetry remains unchanged.
- `thinking_overridden` telemetry remains provider-attempt-aware and now includes `source: "model_policy"`.
- The project remains a model/provider-aware harness, not a provider gateway.

### Validation

- `npm test`: 9 test files passed, 93 tests passed.
- `npm run build`: passed.

### Known Caveat

- The policy schema allows future `thinking: enabled` overrides, but the policy shape remains narrow and strict. Overrides only apply when explicitly declared in a model policy.
