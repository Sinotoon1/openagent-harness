# AGENTS.md

## Project role

This repository implements a TypeScript MCP harness for OSS coding models such as Kimi and DeepSeek.

## Scope guard

Before adding a feature, identify the rightful owner. Do not add IDE/editor context selection, shell/file/git execution, workspace indexing, provider account management, billing/SLA analytics, dashboard UI, deployment automation, or broad eval-pipeline features to this harness. Prefer narrow model/provider-aware utilities with bounded sanitized telemetry and explicit non-production caveats.

## Review expectations

When asked for project feedback:
- Do not modify files unless explicitly asked.
- Inspect implementation, tests, README, configs, and package scripts.
- Cite concrete files and line numbers.
- Separate implemented, partially implemented, missing, and risky behavior.
- Run available validation commands when safe:
  - npm test
  - npm run build
- If a command fails, report the exact failing command and likely cause.
- Prioritize feedback as P0, P1, P2.
- Prefer actionable engineering tasks over vague suggestions.
- Do not claim production readiness unless evidence supports it.

## Architecture checklist

Evaluate the project against:
- issue-path precise repair
- valid-input zero-touch
- repair vs semantic normalization separation
- model-readable retry messages
- model-specific YAML policies
- canonical model id and provider slug boundary
- provider-specific session pinning
- capability negotiation
- thinking-mode overrides
- streaming and fallback semantics
- context compaction by effective context
- telemetry and policy suggestion loop
- security boundaries and secret handling
