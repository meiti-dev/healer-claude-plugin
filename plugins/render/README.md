# Render for Claude Code

Render testing built for AI agents: instead of screenshots, the agent gets a **map of the screen** (every element with its role, name, text, state and position), does **actions by intent** (`click "Save"`, `fill "Email"`), and **sees by comparing maps**: what appeared, disappeared, changed or moved, plus the requests sent and their status.

## Install

```
/plugin marketplace add meiti-dev/healer-claude-plugin
/plugin install render@meiti
```

It runs `npx -y @meiti/render` (Node 18 or newer). It needs a Chrome: the one puppeteer downloads, the Chrome installed on the machine, or the executable in `MEITI_RENDER_CHROME`.

## Use

- `/render <url> [what to check]`, or just ask Claude to check a screen after a UI change.
- Signed-in pages: the session goes in `storage`, `cookies` or `headers` (test accounts only).
- `wait_for` waits for an element that appears after a request.

More: [meiti.dev/agents](https://meiti.dev/agents) · [github.com/meiti-dev/render](https://github.com/meiti-dev/render)

License: MIT
