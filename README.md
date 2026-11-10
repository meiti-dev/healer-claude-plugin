# Healer for Claude Code

Independent verification for your code, without leaving Claude Code. Healer runs your tests in an isolated sandbox, repairs what fails and only gives back changes that leave the project better, never worse.

## Install

1. Get a free API key at [meiti.dev/healer](https://meiti.dev/healer) (panel, API Keys).
2. Set it in your environment: `export HEALER_API_KEY=sanador_...`
3. In Claude Code:

```
/plugin marketplace add meiti-dev/healer-claude-plugin
/plugin install healer@meiti
```

## Use

```
/healer            # free level (open models, no cost)
/healer pro        # pro level (uses your plan)
/healer tests/test_api.py::test_login   # only these tests define "fixed"
```

Claude sends the project, waits for Healer, shows you the result and the diff, and asks before writing anything.

## Other agents (DeepSeek Harness, Cursor, any MCP client)

The Healer tools are a plain MCP server with no dependencies (`mcp/servidor.mjs`, Node 18+), so any agent that speaks MCP over stdio can use them. Clone this repository and point your agent to that file.

**DeepSeek Harness** (one `@deepseek-ai/dsh-mcp-client` row per MCP server, in your Cordis config):

```yaml
- id: healer
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: healer
    command: node
    args: ['/path/to/healer-claude-plugin/mcp/servidor.mjs']
    env:
      HEALER_API_KEY: sanador_...
```

The tools show up as `mcp__healer__healer_revisar`, `mcp__healer__healer_resultado` and `mcp__healer__healer_aplicar`. Ask the agent to send the project to Healer, wait for the result and show you the diff before applying.

This configuration follows the DeepSeek Harness MCP documentation. If your Harness version expects something different, please open an issue.

## What gets sent

Only what git tracks plus new files that are not ignored. Binaries and files over 1 MB are skipped. On the free level, your code may be used to improve Healer's models; for private code, use pro.

## Tools

| Tool | What it does |
|---|---|
| `healer_revisar` | Sends the project and returns a job id |
| `healer_resultado` | Checks the job; when it finishes, returns the summary and the diff |
| `healer_aplicar` | Writes the changes, only if each file is still the same as when it was sent |
