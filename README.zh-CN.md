# tmux-bridge

[English](README.md) | **简体中文**

独立的 MCP 服务器 + CLI 适配器，通过 tmux 实现跨面板 AI Agent 通信。除 `tmux` 本身外无任何外部依赖。

- **MCP Agent** — Gemini CLI、Claude Code 或任何 MCP 客户端，通过结构化 tool call 操作 tmux 面板
- **非 MCP Agent** — `kimi-tmux` 封装 Kimi CLI，自动解析 tool call 并支持多轮对话
- **所有 Agent** — 内置 system instruction，开箱即用 read-act-read 工作流

```bash
# MCP Agent（Gemini、Claude Code）
npx @anthropic-fans/tmux-bridge

# Kimi CLI
kimi-tmux "让 codex 面板 review src/auth.ts"
```

![架构图](docs/images/architecture.png)

## 前置条件

- **tmux 3.2+** — 唯一的运行时依赖
  - macOS: `brew install tmux`
  - Linux: `apt install tmux` / `dnf install tmux`

## 安装

```bash
npm install -g @anthropic-fans/tmux-bridge
```

## MCP 服务器

通过 stdio 协议，兼容任何 MCP 客户端。

### Gemini CLI

添加到 `~/.gemini/settings.json`：

```json
{
  "mcpServers": {
    "tmux-bridge": {
      "command": "npx",
      "args": ["@anthropic-fans/tmux-bridge"]
    }
  }
}
```

### Claude Code

添加到 MCP 配置：

```json
{
  "mcpServers": {
    "tmux-bridge": {
      "command": "npx",
      "args": ["@anthropic-fans/tmux-bridge"]
    }
  }
}
```

### 可用工具

| 工具 | 说明 |
|------|------|
| `tmux_list` | 列出所有面板：target、进程、标签、工作目录 |
| `tmux_read` | 读取面板最后 N 行（满足 read guard） |
| `tmux_type` | 向面板输入文字，不按回车 |
| `tmux_message` | 发送消息，自动附加发送者信息 |
| `tmux_keys` | 发送特殊按键（Enter、Escape、C-c 等） |
| `tmux_name` | 为面板设置标签，方便寻址 |
| `tmux_resolve` | 通过标签查找面板 ID |
| `tmux_id` | 输出当前面板的 tmux ID |
| `tmux_doctor` | 诊断 tmux 连接问题 |

## Kimi CLI 适配器

Kimi CLI 不原生支持 MCP。`kimi-tmux` 弥补了这个缺口：

```bash
kimi-tmux "列出所有 tmux 面板"
kimi-tmux "让 codex 面板 review src/auth.ts"
kimi-tmux "看看 claude 在做什么"
kimi-tmux --rounds 3 "给 gemini 发消息并等结果"
```

![Kimi CLI 桥接流程](docs/images/kimi-bridging.png)

工作原理：

1. 将 system instruction 注入为 system prompt
2. 以 `--print` 非交互模式运行 Kimi
3. 解析输出中的 ` ```tool``` ` 代码块（支持 JSON 和函数调用格式）
4. 通过 `tmux-bridge` CLI 执行命令
5. 将结果回传，保留完整对话上下文（最多 5 轮）

## Read-Act-Read 工作流

所有跨面板交互都遵循相同的模式：

![Read-Act-Read 工作流](docs/images/read-act-read.png)

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | **READ** | 读取目标面板，满足 read guard |
| 2 | **ACT** | 输入消息或发送按键 |
| 3 | **READ** | 验证文字已正确输入 |
| 4 | **KEYS** | 按回车提交 |
| - | **STOP** | 不要轮询回复，对方 Agent 会直接回复到你的面板 |

## Agent 协作示例

### Gemini ↔ Claude Code（通过 MCP 服务器）

```
tmux_read(target="claude", lines=20)
tmux_message(target="claude", text="src/auth.ts 的测试覆盖率是多少？")
tmux_read(target="claude", lines=5)
tmux_keys(target="claude", keys=["Enter"])
```

### Kimi ↔ 任意 Agent（通过 kimi-tmux）

```bash
kimi-tmux "告诉 claude 面板跑一下测试套件"
```

### 多 Agent 配置

```
┌───────────────────────────────────────────────────────────┐
│ tmux 会话                                                  │
│                                                           │
│ ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌───────────┐ │
│ │ Claude Code │ │   Codex    │ │ Gemini   │ │   Kimi    │ │
│ │  (skill)   │ │  (skill)   │ │  (MCP)   │ │(kimi-tmux)│ │
│ │            │ │            │ │          │ │           │ │
│ │ 标签:      │ │ 标签:      │ │ 标签:    │ │ 标签:     │ │
│ │ claude     │ │ codex      │ │ gemini   │ │ kimi      │ │
│ └─────┬──────┘ └─────┬──────┘ └────┬─────┘ └─────┬─────┘ │
│       └──────────────┴─────────────┴─────────────┘       │
│                tmux-bridge（跨面板 IPC）                    │
└───────────────────────────────────────────────────────────┘
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TMUX_BRIDGE_PATH` | `tmux-bridge` 二进制路径 | `tmux-bridge`（从 PATH） |
| `KIMI_PATH` | `kimi` 二进制路径（仅 kimi-tmux） | `kimi`（从 PATH） |

## 路线图

### v0.1（当前）
- MCP 服务器，封装全部 9 个 `tmux-bridge` 命令
- `kimi-tmux` CLI 适配器，支持多轮 tool loop 和完整 transcript
- 适用于任何 Agent 的 system instruction

### v0.2
- 自动通过进程检测为面板打标签
- Agent 间心跳检测
- Agent 能力广播

## 相关项目

| 项目 | 方式 | 重点 |
|------|------|------|
| [smux](https://github.com/ShawnPana/smux) | tmux skill + bash CLI | Agent 通用的 tmux 配置 |
| [agent-bridge](https://github.com/raysonmeng/agent-bridge) | WebSocket daemon + MCP 插件 | Claude Code ↔ Codex |
| **tmux-bridge**（本项目） | 独立 MCP 服务器 + 直接 tmux | 任何 Agent，零依赖 |

## 许可证

MIT
