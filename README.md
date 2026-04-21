# claudecode-useage

Claude Code 实时 Token 用量与费用统计插件。

在对话框底部实时显示当前会话 + 最近 5 小时、7 天、30 天的各模型 Token 用量及费用（按 Anthropic 官方 API 价格计算）。

Real-time token usage and cost statistics for Claude Code, displayed in the status line at the bottom of the conversation.

---

## Preview / 预览

```
NOW: Opus 4.6  $1.75  ████░░░░░░ 35%  4m42s  +656/-0
5H:  opus-4-6 $17.93(6.3Min/37.2Kout)  Total:$17.93
7D:  opus-4-6 $33.52(13.2Min/45.0Kout)  Total:$33.52
30D: opus-4-6 $297.94(96.2Min/312.1Kout) | gpt-5.1-codex $0.00(1.2Min/4.1Kout)  Total:$297.94
```

---

## Features / 功能

- **Current session (NOW)** — 实时显示当前会话的模型、费用、上下文窗口进度条、用时、代码行变更
- **Historical stats (5H/7D/30D)** — 按时间窗口显示各模型 Token 用量和费用
- **Per-model breakdown** — 按模型分别统计 (Opus, Sonnet, Haiku...)
- **Auto refresh** — 每次 Claude 回复后通过 Stop Hook 自动刷新统计数据
- **Detailed report** — 通过 `/claudecode-useage:usage` 查看完整详细报表
- **Zero token cost** — 状态栏和 Hook 均在本地运行，不消耗 API token
- **Zero dependencies** — 纯 Node.js，无需 npm install

---

## Requirements / 前置要求

- Node.js >= 18
- Claude Code (any recent version with statusLine support)

---

## Installation / 安装

### One-click install / 一键安装

```bash
git clone https://github.com/Unlimited223/claudecode-useage.git
node claudecode-useage/scripts/install.mjs
```

Then **restart Claude Code** to activate.

安装后**重启 Claude Code** 即可生效。

### What the installer does / 安装器做了什么

1. Registers the plugin in `~/.claude/plugins/installed_plugins.json`
2. Configures `statusLine` in `~/.claude/settings.json` to display stats
3. Creates cache directory at `~/.claude/plugins/data/claudecode-useage/`
4. Generates initial usage cache

---

## Uninstall / 卸载

```bash
node claudecode-useage/scripts/install.mjs --uninstall
```

Restart Claude Code after uninstalling.

---

## Usage / 使用

### Status Line (automatic / 自动)

After installation, the status line at the bottom of the conversation shows 4 lines:

| Line | Content |
|------|---------|
| **NOW** | Current session: model, cost, context window progress bar, duration, lines changed |
| **5H** | Last 5 hours: per-model token usage and cost |
| **7D** | Last 7 days: per-model token usage and cost |
| **30D** | Last 30 days: per-model token usage and cost |

Stats refresh automatically after each Claude response. The status line also refreshes every 10 seconds.

### Detailed Report / 详细报表

Type in Claude Code:

```
/claudecode-useage:usage
```

This shows a full table with Input, Output, Cache Write, Cache Read tokens and cost per model.

---

## Pricing / 价格

Based on [Anthropic official API pricing](https://docs.anthropic.com/en/docs/about-claude/models):

| Model | Input $/MTok | Output $/MTok | Cache Write $/MTok | Cache Read $/MTok |
|-------|-------------|--------------|-------------------|------------------|
| Opus 4.6/4.7 | $15 | $75 | $18.75 | $1.50 |
| Sonnet 4.5/4.6 | $3 | $15 | $3.75 | $0.30 |
| Haiku 4.5 | $0.80 | $4 | $1.00 | $0.08 |

To update pricing, edit the `PRICING` object in `scripts/usage-stats.mjs`.

---

## Manual Installation / 手动安装 (alternative)

If you prefer manual setup:

1. Add to `~/.claude/plugins/installed_plugins.json`:

```json
{
  "claudecode-useage@local": [
    {
      "scope": "user",
      "installPath": "/path/to/claudecode-useage",
      "version": "1.0.0",
      "installedAt": "2026-04-21T00:00:00.000Z",
      "lastUpdated": "2026-04-21T00:00:00.000Z",
      "projectPath": null
    }
  ]
}
```

2. Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/path/to/claudecode-useage/scripts/statusline.mjs\"",
    "refreshInterval": 10
  }
}
```

3. Create cache directory and generate initial cache:

```bash
mkdir -p ~/.claude/plugins/data/claudecode-useage
node /path/to/claudecode-useage/scripts/usage-stats.mjs --update-cache
```

4. Restart Claude Code.

---

## License

MIT
