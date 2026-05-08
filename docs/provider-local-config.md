# Local Provider Configuration

Provider config exists to map harness-owned provider IDs to local
OpenAI-compatible provider endpoints and provider-native model slugs. The harness
keeps canonical model IDs such as `deepseek-v4-pro` stable at the MCP boundary,
then translates them to provider-specific slugs only at the provider adapter.

By default, the bundled `src/providers/providers.yaml` is used in development and
`dist/providers/providers.yaml` is used after build. Set
`OSS_HARNESS_PROVIDER_CONFIG_PATH` to load a user-editable YAML file instead. The
external file replaces the bundled provider config; this candidate does not deep
merge external and bundled provider entries. If the external file omits a model
slug mapping that exists in the bundled config, that bundled mapping is not used.
The external file is the complete provider config for that run.

Do not edit `dist/providers/providers.yaml` directly. It is build output and can
be overwritten by `npm run build`.

Keep local config files out of git. The repository `.gitignore` excludes
`providers.local.yaml`, `.env`, and `.env.local`; keep any real local copies at
those ignored paths or outside the repository.

## Security Boundary

Provider YAML contains environment variable names, not secret values:

- `baseUrlEnv` names the environment variable containing the provider base URL.
- `authEnvVar` names the environment variable containing the API key.
- model slug `env` fields name optional environment variables for provider-native
  model slug overrides.

Never commit real API keys, bearer tokens, or provider account credentials. The
harness does not read API key values from YAML, does not print env values, and
does not perform live provider credential checks.

API keys stay in environment variables only. Provider YAML should contain only
the names of those variables, for example `DEEPSEEK_PRIMARY_API_KEY`, never the
secret values they point to.

## Example Files

- [examples/providers.local.example.yaml](../examples/providers.local.example.yaml)
- [examples/.env.example](../examples/.env.example)

Copy the example provider YAML to a local ignored path, then point
`OSS_HARNESS_PROVIDER_CONFIG_PATH` at that copy.

The example files are placeholders. Replace placeholder values only in your
ignored local copies, not in the committed examples.

## PowerShell

```powershell
$env:OSS_HARNESS_PROVIDER_CONFIG_PATH = "D:\Work\Python\openagent-harness\providers.local.yaml"
$env:DEEPSEEK_PRIMARY_BASE_URL = "https://deepseek-primary.example/v1"
$env:DEEPSEEK_PRIMARY_API_KEY = "YOUR_KEY"
$env:DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG = "deepseek-v4-pro"

npm run build
node dist/server.js
```

## Claude Code MCP

```powershell
claude mcp add --transport stdio `
  --env OSS_HARNESS_PROVIDER_CONFIG_PATH=D:\Work\Python\openagent-harness\providers.local.yaml `
  --env DEEPSEEK_PRIMARY_BASE_URL=https://deepseek-primary.example/v1 `
  --env DEEPSEEK_PRIMARY_API_KEY=YOUR_KEY `
  --env DEEPSEEK_PRIMARY_DEEPSEEK_V4_PRO_SLUG=deepseek-v4-pro `
  oss-agent-harness `
  -- node D:\Work\Python\openagent-harness\dist\server.js
```

## Error Meanings

`No configured provider supports <modelId>` means no enabled provider has a
mapping for that canonical `modelId`. A provider is enabled only when its
`baseUrlEnv` environment variable has a value.

`HTTP 400 before_first_token` means the provider was reached, but rejected the
provider-native model slug, capability flags, or request shape before returning
assistant output.

Provider config load errors are local configuration errors:

- `Provider config file not found`: the external path does not exist.
- `Provider config YAML is invalid`: the external file is not valid YAML.
- `Provider config is invalid`: the YAML parsed, but failed the strict provider
  config schema, including missing required fields.
