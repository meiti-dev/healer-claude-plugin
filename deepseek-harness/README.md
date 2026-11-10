# Healer for DeepSeek Harness

[中文](README.zh.md)

Independent verification for your code, inside DeepSeek Harness. Healer runs your tests in an isolated sandbox, repairs what fails and only gives back changes that leave the project better, never worse. It is a second opinion from a different team of models.

## Install

1. Connect your Healer account (free) in a terminal. You get a short code to confirm in the browser, no keys to copy:

   ```
   npx @meiti/healer --for "DeepSeek Harness" --no-plugin
   ```

2. Add the plugin to your profile and restart DSH:

   ```
   dsh plugin --profile web add "github:meiti-dev/healer-claude-plugin#path:/deepseek-harness"
   ```

   Use the profile you run (`web`, `tui`, `headless`...).

## Use

Ask the agent: "Send this project to Healer, wait for the result and show me the diff before applying." The tools are:

| Tool | What it does |
|---|---|
| `mcp__healer__healer_revisar` | Sends the project and returns a job id |
| `mcp__healer__healer_resultado` | Checks the job; when it finishes, returns the summary and the diff |
| `mcp__healer__healer_aplicar` | Writes the changes, only if each file is still the same as when it was sent |

## How it works

The plugin adds one MCP server through the official `@deepseek-ai/dsh-mcp-client`: `npx -y -p @meiti/healer@0.1.0 healer-mcp`, the same dependency-free server used by the Healer plugin for Claude Code. See `cordis.patch.yml`.

## What it runs, sends and stores

- **Runs:** `git ls-files` to choose what to send and `git diff --no-index` to show each proposed change.
- **Sends:** the project files (what git tracks plus new files that are not ignored; binaries and files over 1 MB are skipped) to `https://healer-api.meiti.dev`, over HTTPS. Nothing else, nowhere else.
- **Reads your key** from `HEALER_API_KEY` or, if unset, from `~/.healer/config.json`, and sends it only to the Healer API.
- **Stores** a small JSON file per job in your temporary folder, and writes to your project only when `healer_aplicar` is called.

**Free level and your code:** the free level repairs with free AI providers, which may keep and use what they receive, and the repaired code may be used to train Healer's models. On the pro level none of your code is used for training. For private code, use pro.

Made by [MEITI](https://meiti.dev/healer). MIT license. DeepSeek Harness is in developer preview; if a new version breaks this plugin, please open an issue.
