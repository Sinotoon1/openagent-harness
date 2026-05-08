# Internal Distribution From `.tgz`

This candidate can be shared internally as an npm tarball after a clean local
build and dry-run package check. It is still a v1 candidate, not a production-ready
v1 release.

## Create The Tarball

```bash
npm test
npm run build
npm pack --dry-run
npm pack
```

Review the `npm pack --dry-run` output before sharing. The tarball should include
`dist/`, copied policy YAML under `dist/policies/`, copied provider config under
`dist/providers/providers.yaml`, `README.md`, `CHANGELOG.md`, `docs/`, and
`examples/`. It should not include `src/`, `tests/`, `node_modules/`, local `.env`
files, `providers.local.yaml`, `*.jsonl`, unpacked `package/`, or prior `*.tgz`
artifacts.

## Run From An Unpacked Tarball

The `.tgz` does not include `node_modules`. Internal users should install runtime
dependencies inside the unpacked package directory before running the server.

```bash
tar -xzf oss-agent-harness-mcp-1.0.0-candidate.25.tgz
cd package
npm install --omit=dev
node dist/server.js
```

For PowerShell users, extract the tarball with your preferred archive tool, then:

```powershell
Set-Location .\package
npm install --omit=dev
node dist/server.js
```

## Local Config

Use environment variables for secrets. Do not put API keys in provider YAML. Set
`OSS_HARNESS_PROVIDER_CONFIG_PATH` only when using a local provider config file;
that file fully replaces the bundled provider config and is not deep-merged.

Never commit `.env`, `.env.local`, `providers.local.yaml`, JSONL telemetry files,
unpacked `package/`, or generated `*.tgz` artifacts.
