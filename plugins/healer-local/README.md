# Healer for Claude Code (local server)

This is the version with a local MCP server, for terminal users who prefer it: it reads the project and writes the fixes itself, with no upload command. The [healer](https://github.com/meiti-dev/healer-claude-plugin/tree/main/plugins/healer) plugin uses the remote Healer server instead and is the one in the Claude plugin directory.

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
2. In Claude Code:

```
/plugin marketplace add meiti-dev/healer-claude-plugin
/plugin install healer-local@meiti
```

3. Paste the key when Claude Code asks for it (or later in `/plugin` > healer > Configure) and restart Claude Code.

</details>

## Use

```
/healer-local:healer            # free level (open models, no cost)
/healer-local:healer pro        # pro level (uses your plan)
/healer-local:healer tests/test_api.py::test_login   # only these tests define "fixed"
```

Claude sends the project, waits for Healer, shows you the result and the diff, and asks before writing anything.

## Other agents (DeepSeek Harness, Cursor, any MCP client)

The Healer tools are a plain MCP server with no dependencies (Node 18+), so any agent that speaks MCP over stdio can use them. Connect once with `npx @meiti/healer --for "Your agent" --no-plugin`, then add the server with `npx -y -p @meiti/healer healer-mcp`: it reads the saved key.

**DeepSeek Harness** has its own plugin in [`meiti-dev/healer-dsh-plugin`](https://github.com/meiti-dev/healer-dsh-plugin):

```
npx @meiti/healer --for "DeepSeek Harness" --no-plugin
dsh plugin --profile web add github:meiti-dev/healer-dsh-plugin
```

Restart DSH and the tools show up as `mcp__healer__healer_revisar`, `mcp__healer__healer_resultado` and `mcp__healer__healer_aplicar`. Ask the agent to send the project to Healer, wait for the result and show you the diff before applying. Tested with DSH 0.2.2-rc.1 on Windows.

## What this plugin runs, sends and stores

Nothing happens until you (or Claude, after you ask) call one of the tools. Then:

- **Runs:** nothing. It starts no programs, has no hooks and no background process. It reads your project's `.gitignore` files itself to choose what to send, and builds the diffs itself.
- **Sends:** the project files to the Healer API at `https://healer-api.meiti.dev` (operated by MEITI, the makers of Healer), over HTTPS. The same files git would send (it honors every `.gitignore`); binaries, files over 1 MB and secret files (`.env`, `*.pem`, `*.key`, `id_rsa` and similar) are always skipped. Nothing is sent anywhere else.
- **Gets your key** only from the plugin's `api_key` option, which Claude Code stores as a sensitive value. `npx @meiti/healer` fills it in for you, or you can paste a key in `/plugin` > healer > Configure. The key is sent only to the Healer API, as the `x-api-key` header, and is never printed. (Outside Claude Code, the same server reads `HEALER_API_KEY` or `~/.healer/config.json`.)
- **Stores:** a small JSON file per job in your system's temporary folder (`healer-claude-code/`), with the job id, the project path and Healer's proposed files, so the changes can be shown and applied later.
- **Writes to your project:** only when `healer_aplicar` is called after you say yes, and only files that are still exactly as they were when sent.

Healer runs your tests in an isolated sandbox on its servers. See [meiti.dev/healer](https://meiti.dev/healer) for its terms.

**Free level and your code:** the free level repairs with free AI providers (Groq, NVIDIA and Gemini). The repaired code may be reused to train Healer's models, and those providers may keep and use what they receive to improve theirs. On the pro level none of your code is used for training. For private code, use pro.

## Tools

| Tool | What it does |
|---|---|
| `healer_revisar` | Sends the project and returns a job id |
| `healer_resultado` | Checks the job; when it finishes, returns the summary and the diff |
| `healer_aplicar` | Writes the changes, only if each file is still the same as when it was sent |
