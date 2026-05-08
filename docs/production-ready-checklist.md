# Production-Ready v1 Checklist

This project remains a v1 candidate until these criteria are met and reviewed.

- [ ] At least 2-3 real provider matrix smoke tests are completed and recorded using `docs/provider-matrix.md`.
- [ ] JSONL telemetry caveats are explicitly accepted for v1 or hardened beyond current local diagnostics with bounded reads, rotation guidance, and multi-process write expectations.
- [ ] Security audit has no P0 findings and no unresolved secret-handling or response-sanitization blockers.
- [ ] `npm pack --dry-run` is clean: built `dist`, copied policies, copied provider config, `README.md`, `CHANGELOG.md`, and useful `docs/` are included without unexpected source, test, telemetry, or secret files.
- [ ] MCP client examples for Codex CLI, Claude Code, VS Code, and OpenCode are verified against the current package name, command, environment variables, and tool names.
- [ ] Scope remains within the responsibility boundary: no IDE/editor context selection, shell/file/git execution, workspace indexing, provider account management, billing/SLA analytics, dashboard UI, deployment automation, or broad eval-pipeline behavior.
- [ ] Internal `.tgz` install instructions are verified from a clean unpacked `package/` using `npm install --omit=dev` and `node dist/server.js`.
- [ ] License choice is made and documented before claiming production-ready v1.
- [ ] No known release blockers remain in `docs/release-readiness-audit.md`.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
