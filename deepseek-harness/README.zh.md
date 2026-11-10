# Healer for DeepSeek Harness（中文）

[English](README.md)

在 DeepSeek Harness 里为你的代码做独立验证。Healer 会在隔离的沙箱中运行你的测试，修复失败的部分，并且只返回让项目变得更好的修改，绝不会让项目变差。它相当于来自另一组模型的“第二意见”。

## 安装

1. 在终端里连接你的 Healer 账号（免费）。你会拿到一个短代码，在浏览器里确认即可，不需要复制任何密钥：

   ```
   npx @meiti/healer --for "DeepSeek Harness" --no-plugin
   ```

2. 把插件加入你的 profile，然后重启 DSH：

   ```
   dsh plugin --profile web add "github:meiti-dev/healer-claude-plugin#path:/deepseek-harness"
   ```

   请换成你实际使用的 profile（`web`、`tui`、`headless` 等）。

卸载：`dsh plugin --profile web remove @meiti/healer-dsh`（同时会从 profile 的 bundle 列表中移除）。

## 使用

对 agent 说：“把这个项目发给 Healer，等结果出来，应用之前先给我看 diff。” 可用的工具：

| 工具 | 作用 |
|---|---|
| `mcp__healer__healer_revisar` | 发送项目，返回任务 id |
| `mcp__healer__healer_resultado` | 查询任务；完成后返回摘要和 diff |
| `mcp__healer__healer_aplicar` | 写入修改，前提是每个文件仍与发送时完全一致 |

## 工作原理

插件通过官方的 `@deepseek-ai/dsh-mcp-client` 添加一个 MCP 服务器：`npx -y -p @meiti/healer@0.2.0 healer-mcp`，与 Healer 的 Claude Code 插件使用的是同一个无依赖服务器。详见 `cordis.patch.yml`。

## 它会运行、发送和保存什么

- **运行：** 除服务器本身外不运行任何程序。它自行读取项目的 `.gitignore` 来选择要发送的文件，并自行生成 diff。
- **发送：** 项目文件（与 git 会发送的文件相同；始终跳过二进制文件、超过 1 MB 的文件以及 `.env`、`*.pem` 等密钥文件），通过 HTTPS 发送到 `https://healer-api.meiti.dev`。不会发送到其他任何地方。
- **读取密钥：** 从 `HEALER_API_KEY` 读取；若未设置，则从 `~/.healer/config.json` 读取。密钥只会发送给 Healer API。
- **保存：** 每个任务在系统临时目录中保存一个小的 JSON 文件；只有调用 `healer_aplicar` 时才会写入你的项目。

**免费档与你的代码：** 免费档使用免费的 AI 服务商进行修复，这些服务商可能会保存并使用它们收到的内容，修复后的代码也可能被用于训练 Healer 的模型。专业档（pro）不会用你的任何代码做训练。私有代码请使用专业档。

由 [MEITI](https://meiti.dev/healer) 开发，MIT 许可证。DeepSeek Harness 目前处于开发者预览阶段；如果新版本导致插件失效，请提交 issue。
