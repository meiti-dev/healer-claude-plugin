# Healer for Claude Code

Independent verification for your code, without leaving Claude Code. Healer runs your tests in an isolated sandbox, repairs what fails and only gives back changes that leave the project better, never worse. It is a second opinion from a different team of models.

This plugin connects Claude Code to the Healer server (a remote MCP server at `https://healer-api.meiti.dev/mcp`). It installs no programs on your computer.

## What is in this repository

| Folder | What it is |
|---|---|
| [`plugins/healer`](plugins/healer) | The Claude Code plugin (also in the Claude plugin directory). Connects to the remote Healer server; installs no programs on your computer. |
| [`plugins/healer-local`](plugins/healer-local) | The same Healer with a local MCP server, for terminal users who prefer it. |
| [`healer-dsh-plugin`](https://github.com/meiti-dev/healer-dsh-plugin) | The DeepSeek Harness plugin. |

## Install

**Type this:**

```
npx @meiti/healer
```

**or tell your agent:** "Install Healer: meiti.dev/healer/install.txt"

Either way you get a short code (like `HEAL-7K2Q-ABCD`), confirm it in the browser with one click, and you are done: no keys to copy or paste. Confirming the code is always your step: no agent can connect your account on its own.

<details><summary>Manual install</summary>

1. Get a free API key at [meiti.dev/healer](https://meiti.dev/healer) (panel, API Keys).
2. Install the plugin from the Claude plugin directory, or in Claude Code:

```
/plugin marketplace add meiti-dev/healer-claude-plugin
/plugin install healer@meiti
```

3. Paste the key when Claude Code asks for it (or later in `/plugin` > healer > Configure) and restart Claude Code.

</details>

## Use

```
/healer            # free level (open models, no cost)
/healer pro        # pro level (uses your plan)
/healer tests/test_api.py::test_login   # only these tests define "fixed"
```

Claude uploads the project, waits for Healer, shows you the result and the diff, and asks before writing anything. Without a terminal (claude.ai, mobile), Claude can review a GitHub repository through your Healer organization's GitHub connection instead.

## How it works

| Tool | What it does |
|---|---|
| `healer_preparar_envio` | Returns a one-time upload link (15 minutes) and the command to upload the project from its folder |
| `healer_revisar_repo` | Reviews a GitHub repository, with your Healer organization's GitHub connection |
| `healer_resultado` | Checks the job; when it finishes, returns the summary, the diff and a signed link to the patch |
| `healer_aplicar_en_github` | Commits the changes to the reviewed branch, only if those files did not change since the review |

## What runs, what is sent and what is stored

- **On your computer, the plugin runs nothing.** It has no programs, no hooks and no background process. Claude runs two commands, each one with your permission: the upload (`git ls-files` or `tar`, then `curl` to the one-time link) and, only after you say yes, `git apply` with Healer's patch. `git apply` refuses any file that changed since it was sent.
- **Sent:** the project files, over HTTPS, to the Healer server at `healer-api.meiti.dev` (operated by MEITI, the makers of Healer). With git, only tracked files plus new files that are not ignored. On arrival Healer drops anything in a `.gitignore`, secret files (`.env`, `*.pem`, `*.key`, `id_rsa` and similar), binaries and files over 1 MB; those are not stored. Nothing is sent anywhere else.
- **Your key** is stored by Claude Code as the plugin's sensitive `api_key` option and is sent only to the Healer server, as the `x-api-key` header.
- **Stored by Healer:** the uploaded files, for 7 days, so the patch can be built; then they are deleted. The job result (including the repaired files) stays in your account's history so you can review it in the panel.

**Free level and your code:** the free level repairs with free AI providers (Groq, NVIDIA and Gemini). The repaired code may be reused to train Healer's models, and those providers may keep and use what they receive to improve theirs. On the pro level none of your code is used for training. For private code, use pro.

## Other agents

The same Healer server works with any agent that supports remote MCP servers: point it to `https://healer-api.meiti.dev/mcp` with your key in the `x-api-key` header (or `Authorization: Bearer`). For terminal agents that prefer a local server, see [`plugins/healer-local`](https://github.com/meiti-dev/healer-claude-plugin/tree/main/plugins/healer-local) and the [DeepSeek Harness plugin](https://github.com/meiti-dev/healer-dsh-plugin).

Privacy: [meiti.dev/healer/privacy.html](https://meiti.dev/healer/privacy.html). MIT license.
