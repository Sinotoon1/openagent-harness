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
