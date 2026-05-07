# Release Readiness Audit For v1.0.0-candidate.15

Audit date: 2026-05-08

Scope inspected:

- `README.md`
- `CHANGELOG.md`
- `AGENTS.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/server.ts`
- `docs/`
- `tests/`
- MCP client config examples
- provider matrix docs
- release notes
- npm package files/include behavior

## Blocker

- None found for tagging `v1.0.0-candidate.15`.

## Before Production-Ready v1

- Complete and record at least 2-3 real provider smoke tests from `docs/provider-matrix.md`.
- Decide and document package licensing. The package currently has no `license` field and no license file.
- Decide whether current JSONL telemetry caveats are acceptable for v1 or harden them before declaring production readiness.
- Run a security audit/review and confirm no P0 findings remain.

## Candidate Caveat

- Provider IDs remain placeholders until configured with real OpenAI-compatible services.
- Provider config validation is static and does not validate live accounts, credentials, quota, cost, or availability.
- Streaming support collects final text for MCP responses; it does not expose incremental MCP streaming.
- Context compaction uses effective-context policy and heuristic summaries but does not guarantee a post-compaction token target.
- Telemetry reports and repair policy suggestions use bounded latest windows, not full historical analytics.
- `npm audit` has not been made part of the release validation script set.

## Later

- Consider an explicit `exports` map only if the package grows supported library APIs beyond the CLI bin.
- Consider adding a lint script if maintainers want a separate style gate beyond `tsc` and tests.
- Consider documenting completed provider smoke-test evidence in a separate release artifact once real provider credentials are available.
