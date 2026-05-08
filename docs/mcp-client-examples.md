# MCP Client Examples

These examples use the current package name, `oss-agent-harness-mcp`, and the
same provider environment variables used by the runtime. Replace placeholder
URLs and API keys with real OpenAI-compatible provider settings.
Set `OSS_HARNESS_PROVIDER_CONFIG_PATH` as well when you want a user-editable
provider config file to replace the bundled provider config.

For local development from this repository, run `npm run build` first and point
clients at `node D:/Work/Python/openagent-harness/dist/server.js`.

For an installed npm package, use the package bin command
`oss-agent-harness-mcp`.

## Codex CLI

Local checkout:

```toml
[mcp_servers.oss-agent-harness]
command = "node"
args = ["D:/Work/Python/openagent-harness/dist/server.js"]
enabled = true

[mcp_servers.oss-agent-harness.env]
OSS_HARNESS_PROVIDER_CONFIG_PATH = "D:/Work/Python/openagent-harness/providers.local.yaml"
DEEPSEEK_PRIMARY_BASE_URL = "https://deepseek-primary.example/v1"
DEEPSEEK_PRIMARY_API_KEY = "YOUR_KEY"
OPENROUTER_FALLBACK_BASE_URL = "https://openrouter-fallback.example/v1"
OPENROUTER_FALLBACK_API_KEY = "YOUR_KEY"
```

Installed package:

```toml
[mcp_servers.oss-agent-harness]
command = "oss-agent-harness-mcp"
enabled = true

[mcp_servers.oss-agent-harness.env]
OSS_HARNESS_PROVIDER_CONFIG_PATH = "D:/Work/Python/openagent-harness/providers.local.yaml"
DEEPSEEK_PRIMARY_BASE_URL = "https://deepseek-primary.example/v1"
DEEPSEEK_PRIMARY_API_KEY = "YOUR_KEY"
OPENROUTER_FALLBACK_BASE_URL = "https://openrouter-fallback.example/v1"
OPENROUTER_FALLBACK_API_KEY = "YOUR_KEY"
```

## Claude Code

Local checkout:

```bash
claude mcp add --transport stdio \
  --env OSS_HARNESS_PROVIDER_CONFIG_PATH=D:/Work/Python/openagent-harness/providers.local.yaml \
  --env DEEPSEEK_PRIMARY_BASE_URL=https://deepseek-primary.example/v1 \
  --env DEEPSEEK_PRIMARY_API_KEY=YOUR_KEY \
  --env OPENROUTER_FALLBACK_BASE_URL=https://openrouter-fallback.example/v1 \
  --env OPENROUTER_FALLBACK_API_KEY=YOUR_KEY \
  oss-agent-harness \
  -- node D:/Work/Python/openagent-harness/dist/server.js
```

Installed package:

```bash
claude mcp add --transport stdio \
  --env OSS_HARNESS_PROVIDER_CONFIG_PATH=D:/Work/Python/openagent-harness/providers.local.yaml \
  --env DEEPSEEK_PRIMARY_BASE_URL=https://deepseek-primary.example/v1 \
  --env DEEPSEEK_PRIMARY_API_KEY=YOUR_KEY \
  --env OPENROUTER_FALLBACK_BASE_URL=https://openrouter-fallback.example/v1 \
  --env OPENROUTER_FALLBACK_API_KEY=YOUR_KEY \
  oss-agent-harness \
  -- oss-agent-harness-mcp
```

## VS Code

Local checkout:

```json
{
  "servers": {
    "ossAgentHarness": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/Work/Python/openagent-harness/dist/server.js"],
      "env": {
        "OSS_HARNESS_PROVIDER_CONFIG_PATH": "D:/Work/Python/openagent-harness/providers.local.yaml",
        "DEEPSEEK_PRIMARY_BASE_URL": "https://deepseek-primary.example/v1",
        "DEEPSEEK_PRIMARY_API_KEY": "YOUR_KEY",
        "OPENROUTER_FALLBACK_BASE_URL": "https://openrouter-fallback.example/v1",
        "OPENROUTER_FALLBACK_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

Installed package:

```json
{
  "servers": {
    "ossAgentHarness": {
      "type": "stdio",
      "command": "oss-agent-harness-mcp",
      "env": {
        "OSS_HARNESS_PROVIDER_CONFIG_PATH": "D:/Work/Python/openagent-harness/providers.local.yaml",
        "DEEPSEEK_PRIMARY_BASE_URL": "https://deepseek-primary.example/v1",
        "DEEPSEEK_PRIMARY_API_KEY": "YOUR_KEY",
        "OPENROUTER_FALLBACK_BASE_URL": "https://openrouter-fallback.example/v1",
        "OPENROUTER_FALLBACK_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

## OpenCode

Local checkout:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "oss-agent-harness": {
      "type": "local",
      "command": ["node", "D:/Work/Python/openagent-harness/dist/server.js"],
      "enabled": true,
      "environment": {
        "OSS_HARNESS_PROVIDER_CONFIG_PATH": "D:/Work/Python/openagent-harness/providers.local.yaml",
        "DEEPSEEK_PRIMARY_BASE_URL": "https://deepseek-primary.example/v1",
        "DEEPSEEK_PRIMARY_API_KEY": "YOUR_KEY",
        "OPENROUTER_FALLBACK_BASE_URL": "https://openrouter-fallback.example/v1",
        "OPENROUTER_FALLBACK_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

Installed package:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "oss-agent-harness": {
      "type": "local",
      "command": ["oss-agent-harness-mcp"],
      "enabled": true,
      "environment": {
        "OSS_HARNESS_PROVIDER_CONFIG_PATH": "D:/Work/Python/openagent-harness/providers.local.yaml",
        "DEEPSEEK_PRIMARY_BASE_URL": "https://deepseek-primary.example/v1",
        "DEEPSEEK_PRIMARY_API_KEY": "YOUR_KEY",
        "OPENROUTER_FALLBACK_BASE_URL": "https://openrouter-fallback.example/v1",
        "OPENROUTER_FALLBACK_API_KEY": "YOUR_KEY"
      }
    }
  }
}
```

Current MCP tool names are:

- `oss_chat`
- `repair_tool_input`
- `compact_context`
- `get_model_policy`
- `record_eval_event`
- `query_telemetry`
- `get_harness_stats`
- `suggest_repair_policy`
- `inspect_model_policies`
- `run_policy_doctor`
