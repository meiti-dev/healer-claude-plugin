# Healer for Claude Code

Independent verification for your code, without leaving Claude Code. Healer runs your tests in an isolated sandbox, repairs what fails and only gives back changes that leave the project better, never worse.

## Install

**Type this:**

```
npx @meiti/healer
```

**or tell your agent:** "Install Healer: meiti.dev/healer/install.txt"

Either way you get a short code (like `HEAL-7K2Q-ABCD`), confirm it in the browser with one click, and you are done: no keys to copy or paste. The installer saves the key in `~/.healer/config.json` and installs this plugin in Claude Code. Confirming the code is always your step: no agent can connect your account on its own.

<details><summary>Manual install</summary>

1. Get a free API key at [meiti.dev/healer](https://meiti.dev/healer) (panel, API Keys).
2. Set it in your environment: `export HEALER_API_KEY=sanador_...`
3. In Claude Code:

```
/plugin marketplace add meiti-dev/healer-claude-plugin
/plugin install healer@meiti
```

</details>

## Use

```
/healer            # free level (open models, no cost)
/healer pro        # pro level (uses your plan)
/healer tests/test_api.py::test_login   # only these tests define "fixed"
```

Claude sends the project, waits for Healer, shows you the result and the diff, and asks before writing anything.

## Other agents (DeepSeek Harness, Cursor, any MCP client)

The Healer tools are a plain MCP server with no dependencies (`mcp/servidor.mjs`, Node 18+), so any agent that speaks MCP over stdio can use them. Connect once with `npx @meiti/healer --for "Your agent" --no-plugin`, then add the server with `npx -y -p @meiti/healer healer-mcp`: it reads the saved key. You can also clone this repository and point your agent to `mcp/servidor.mjs`.

**DeepSeek Harness** (one `@deepseek-ai/dsh-mcp-client` row per MCP server, in your Cordis config):

```yaml
- id: healer
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: stdio
    serverName: healer
    command: npx
    args: ['-y', '-p', '@meiti/healer', 'healer-mcp']
```

The tools show up as `mcp__healer__healer_revisar`, `mcp__healer__healer_resultado` and `mcp__healer__healer_aplicar`. Ask the agent to send the project to Healer, wait for the result and show you the diff before applying.

This configuration follows the DeepSeek Harness MCP documentation. If your Harness version expects something different, please open an issue.

## What gets sent

Only what git tracks plus new files that are not ignored. Binaries and files over 1 MB are skipped.

**Free level and your code:** the free level repairs with free AI providers (Groq, NVIDIA and Gemini). The repaired code may be reused to train Healer's models, and those providers may keep and use what they receive to improve theirs. On the pro level none of your code is used for training. For private code, use pro.

## Tools

| Tool | What it does |
|---|---|
| `healer_revisar` | Sends the project and returns a job id |
| `healer_resultado` | Checks the job; when it finishes, returns the summary and the diff |
| `healer_aplicar` | Writes the changes, only if each file is still the same as when it was sent |
