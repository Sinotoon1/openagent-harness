## oss-agent-harness-mcp v1.0.0-candidate.24

This candidate release is a maintainability-only policy diagnostic helper
extraction.

### Changed

- Added shared pure policy diagnostic helpers for context threshold parsing and
  ordering checks, repair list diagnostics, provider override diagnostics, and
  plain-record/string extraction.
- Reused those helpers from `inspect_model_policies` policy inspection and
  `run_policy_doctor` diagnostics while keeping their public output shapes and
  wording unchanged.
- Updated package metadata and MCP server advertised version to
  `1.0.0-candidate.24`.

### Preserved

- Runtime behavior is unchanged.
- `inspect_model_policies` output is unchanged.
- `run_policy_doctor` output is unchanged.
- MCP tool names, public response shapes, repair behavior, provider routing,
  fallback semantics, streaming parser behavior, telemetry semantics, JSONL
  behavior, security sanitization semantics, context compaction, schema
  descriptor behavior, provider config loading, package file inclusion behavior,
  and policy YAML semantics are unchanged.

### Validation

- `npm test`: 15 test files passed, 163 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 153 files, 86.7 kB package, 416.4 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.23

This candidate release is test-maintainability-only.

### Changed

- Split the oversized `tests/tools.test.ts` coverage into focused MCP tool test
  files for chat, diagnostics, policy, repair, and telemetry behavior.
- Extracted shared test-only helpers for MCP tool registration/calls, fake
  provider responses, telemetry temp files, schema descriptors, sanitized-output
  assertions, repair telemetry fixtures, and common provider fixtures.
- Updated package metadata and MCP server advertised version to
  `1.0.0-candidate.23`.

### Preserved

- Runtime behavior is unchanged.
- MCP tool names, public response shapes, repair behavior, provider routing,
  fallback semantics, streaming parser behavior, telemetry semantics, JSONL
  behavior, security sanitization semantics, context compaction, schema
  descriptor behavior, policy behavior, provider config loading, and package file
  inclusion behavior are unchanged.

### Validation

- `npm test`: 15 test files passed, 163 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 150 files, 86.2 kB package, 413.4 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.22

This candidate release is a maintainability-only constants centralization pass.

### Changed

- Added focused constants modules for MCP tool names, repair names and execution
  order, telemetry event names, capability names, fallback phases, and provider
  sticky-session strategies.
- Reused those constants from tool registration, response helpers, repair
  execution, telemetry stats/suggestions/reporting, capability negotiation,
  provider errors, provider config validation, and sticky-session handling.
- Added focused constants tests for registered MCP tool names, repair execution
  order, telemetry stats constants, and sticky-session strategy acceptance.

### Preserved

- No serialized names or public API names changed.
- MCP tool names, public response shapes, repair behavior, provider routing,
  fallback semantics, streaming parser behavior, telemetry semantics, JSONL
  behavior, security sanitization semantics, context compaction, schema
  descriptor behavior, policy behavior, provider config loading, and package file
  inclusion behavior are unchanged.

### Validation

- `npm test`: 11 test files passed, 163 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 150 files, 86.0 kB package, 412.2 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.21

This candidate release is a maintainability-only cleanup for MCP tool response
helpers.

### Changed

- Extracted common MCP JSON response serialization and invalid-input response
  helpers from `src/tools/index.ts` into `src/tools/responses.ts`.
- Extracted pure `repair_tool_input` response shaping from `src/tools/index.ts`
  into `src/tools/repairResponses.ts`.
- Kept `src/tools/index.ts` focused on registering the existing MCP tools and
  coordinating tool-specific control flow.

### Preserved

- Public MCP response shapes are unchanged.
- `run_policy_doctor` invalid input still uses the no-telemetry invalid response
  path.
- All other tool invalid-input telemetry behavior is unchanged.
- MCP tool names, input schemas, repair behavior, provider routing, fallback
  semantics, streaming parser behavior, telemetry semantics, JSONL behavior,
  security sanitization semantics, context compaction, schema descriptor
  behavior, policy behavior, provider config loading, and package file inclusion
  behavior are unchanged.

### Validation

- `npm test`: 10 test files passed, 159 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 132 files, 83.1 kB package, 396.4 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.20

This candidate release adds real-provider smoke-test documentation and MCP
effectiveness measurement guidance.

### Added

- Added `docs/provider-smoke-results.md` with current local DeepSeek primary
  findings, provider matrix, unsupported-model interpretation, and sanitized raw
  preview expectations.
- Added `docs/mcp-effectiveness-smoke-tests.md` for comparing baseline direct
  provider usage against MCP harness usage, including repair, telemetry,
  fallback, TTFT, and secret-leakage checks.
- Documented token overhead categories and the rough
  `estimatedTokens = Math.ceil(charCount / 4)` formula.
- Added `scripts/estimate-json-tokens.mjs`, a no-dependency local helper for
  estimating JSON payload token overhead from a file or stdin. It is not included
  in package files.
- Linked the new docs from `README.md`.

### Preserved

- No runtime behavior changes were made.
- Provider routing, fallback semantics, streaming parser behavior, telemetry
  semantics, JSONL behavior, repair behavior, context compaction, MCP tool
  names, schema descriptor behavior, policy behavior, and provider config loading
  behavior are unchanged.

### Validation

- `npm test`: 10 test files passed, 159 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 126 files, 81.8 kB package, 390.3 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.19

This candidate release adds user-editable provider config loading.

### Added

- `OSS_HARNESS_PROVIDER_CONFIG_PATH` can point at a local provider YAML file.
- External provider config replaces the bundled provider config; no deep merge is
  performed in this candidate.
- External provider config uses the existing strict provider validation and wraps
  missing file, invalid YAML, and invalid shape failures in clear
  `ProviderConfigError` messages.
- Added local provider and `.env` examples under `examples/`.
- Added local provider config documentation with PowerShell and Claude Code MCP
  setup examples.

### Preserved

- API key values still come only from environment variables, not YAML.
- Provider enablement remains gated by configured base URL environment values.
- No live provider credential checks or provider account management were added.
- Repair behavior, streaming parser behavior, fallback semantics, telemetry sink
  behavior, JSONL behavior, security sanitization, context compaction, MCP tool
  names, schema descriptor behavior, policy behavior, and provider routing
  semantics are unchanged.

### Validation

- `npm test`: 10 test files passed, 159 tests passed.
- `npm run build`: passed.
- `npm pack --dry-run`: passed, 124 files, 78.5 kB package, 378.8 kB unpacked.

## oss-agent-harness-mcp v1.0.0-candidate.18

This candidate release cleans up logical provider IDs and corrects the DeepSeek
flash canonical model ID.

### Changed

- Renamed `providerOne` to `deepseekPrimary`.
- Renamed the primary DeepSeek env vars to `DEEPSEEK_PRIMARY_BASE_URL` and
  `DEEPSEEK_PRIMARY_API_KEY`.
- Renamed the fallback placeholder provider to `openrouterFallback`.
- Corrected `deepseek-flash` to `deepseek-v4-flash`; the old model ID is not
  kept as a broad compatibility alias.
- `deepseekPrimary` now advertises only verified `deepseek-v4-pro` support and
  does not map `kimi-k2-6` or unverified `deepseek-v4-flash`.
- `deepseekPrimary` request-time thinking capability is false, reflecting local
  smoke-test HTTP 400 behavior when thinking is sent.

### Preserved

- No MCP tool names were changed.
- Repair behavior, streaming parser behavior, fallback semantics, telemetry sink
  behavior, JSONL behavior, security sanitization, context compaction, schema
  descriptor behavior, and policy suggestion behavior are unchanged.

### Validation

- `npm test`: 10 test files passed, 149 tests passed.
- `npm run build`: passed.

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

- Moved the DeepSeek v4 Pro + openrouterFallback thinking override out of hardcoded router/capability logic.
- The override now lives in `src/policies/deepseek-v4-pro.yaml`.
- Provider overrides are loaded through the model policy loader.
- Policy overrides are applied after per-attempt capability negotiation.

### Preserved

- DeepSeek v4 Pro + openrouterFallback still runs with thinking disabled.
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
