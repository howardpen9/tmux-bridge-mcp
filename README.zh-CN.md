# tmux-bridge

[English](README.md) | **简体中文**

独立的 MCP 服务器，让 AI Agent（Claude Code、Gemini CLI、Codex、Kimi CLI）通过 tmux 面板互相通信。直接调用 tmux，除 tmux 本身外无任何外部依赖。

## tmux 是什么？

[tmux](https://github.com/tmux/tmux) 是一个**终端多路复用器** -- 它可以把一个终端窗口分成多个**面板**，每个面板独立运行自己的程序。可以理解为终端的"增强版分屏"。

![什么是 tmux](docs/images/what-is-tmux.png)

```
+-------------------------------+
|  面板 1        |  面板 2       |
|  Claude Code   |  Codex       |
|  写代码        |  做 review    |
|                |              |
+----------------+--------------+
|  面板 3        |  面板 4       |
|  Gemini CLI    |  tail -f 日志 |
|  做调研        |  监控         |
+-------------------------------+
```

每个面板都是一个完整的终端。你可以在一个面板里跑 Claude Code，另一个跑 Codex，第三个跑 Gemini -- 同时可见，同一台机器上。

**问题是：** 这些面板之间互相看不见。面板 1 的 agent 完全不知道面板 2 在发生什么。

![问题](docs/images/the-problem.png)

**tmux-bridge 就是解决这个问题的。** 它让每个 agent 都能读取、输入、发送消息到任意其他面板。

![解决方案](docs/images/the-solution.png)

## tmux-bridge 能做什么？

安装之后，你的 AI agent 可以：

| 动作 | 工具 | 举例 |
|------|------|------|
| **查看另一个 agent 在做什么** | `tmux_read` | 读取 Codex 面板的最后 20 行 |
| **给另一个 agent 派任务** | `tmux_message` + `tmux_keys` | 让 Claude review 一个文件 |
| **编排多 agent 工作流** | 串联工具调用 | Gemini 调研 -> Claude 实现 -> Codex 审查 |
| **监控进程** | 对 shell 面板 `tmux_read` | 看构建日志、测试输出、服务器状态 |
| **按角色给面板命名** | `tmux_name` | 命名为 "claude"、"codex"、"gemini"，方便寻址 |

所有操作都是标准 MCP 工具调用 -- agent 不需要学新语法。只要它支持 MCP，就已经会用了。

## 支持的 Agent

![支持的 Agent](docs/images/supported-agents.png)

### 已测试并提供文档

| Agent | 连接方式 | 状态 |
|-------|----------|------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 原生 MCP (stdio) | 已支持 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 原生 MCP (stdio) | 已支持 |
| [Codex CLI](https://github.com/openai/codex) | 原生 MCP (stdio) | 已支持 |
| [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) v1.26+ | 原生 MCP (`kimi mcp add`) | 已支持 |
| [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) 旧版 | Legacy 封装器 (`kimi-tmux`) | 已支持 |

### 理论兼容（任何支持 MCP 的 agent）

| Agent | 备注 |
|-------|------|
| [Cursor](https://cursor.sh) | 设置中支持 MCP 服务器 |
| [Windsurf (Codeium)](https://codeium.com/windsurf) | 支持 MCP 服务器 |
| [Copilot CLI](https://githubnext.com/projects/copilot-cli) | 如果兼容 MCP |
| [Aider](https://aider.chat) | 社区 MCP 支持 |
| [Continue.dev](https://continue.dev) | 支持 MCP 服务器 |
| [Cline](https://github.com/cline/cline) | VS Code 扩展，支持 MCP |
| [Roo Code](https://github.com/RooVetGit/Roo-Code) | Cline 分支，支持 MCP |
| 任何 shell 脚本或进程 | 用 `tmux_read` 读面板输出，无需 MCP |

tmux-bridge 兼容**任何支持 stdio MCP 的 agent**。如果你的 agent 不在上面的列表中，试试添加 MCP 配置 -- 大概率直接能用。

## 为什么需要这个

当你在多个终端里分别运行不同的 AI agent 时，它们各自独立工作。你不得不手动在它们之间复制粘贴上下文、转发问题和回答，或者干脆记不清每个 agent 在做什么。

tmux-bridge 解决这个问题：让每个 agent 都能通过标准 MCP 工具**读取、输入、发送消息到任意其他终端面板**。

**典型场景：**

- **代码审查流水线** -- Claude Code 在一个面板写代码，Codex 在另一个面板 review，结果自动回传
- **多模型推理** -- 让 Gemini 做调研，把结果喂给 Claude，再让 Codex 验证实现
- **并行工作流** -- 多个 Claude Code 实例各负责大任务的不同部分，通过面板消息协调
- **监控** -- agent 读取 `tail -f` 面板的日志输出，实时响应错误

**你需要准备什么：**

| 前置条件 | 为什么 |
|----------|--------|
| **tmux** | 终端多路复用器，承载你的面板 -- 这就是通信通道 |
| **Node.js 18+** | 运行 MCP 服务器 |
| **至少一个 MCP 兼容的 agent** | Claude Code、Gemini CLI、Codex 或 Kimi CLI v1.26+ |

如果你已经在用 tmux 并排运行多个 agent，tmux-bridge 只是让它们彼此感知到对方的存在。

## 快速开始

**1. 安装 tmux**

```bash
# macOS
brew install tmux

# Linux
apt install tmux   # 或 dnf install tmux
```

**2. 安装 tmux-bridge**

```bash
npm install -g @anthropic-fans/tmux-bridge
```

**3. 添加到 Agent 的 MCP 配置**

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

完成。你的 Agent 现在有 9 个 MCP 工具，可以跨 tmux 面板读取、输入和发送消息。

## 工作原理

![分层架构](docs/images/layered-architecture.png)

tmux-bridge 作为 MCP 服务器通过 stdio 运行，直接调用 tmux（`capture-pane`、`send-keys`、`list-panes` 等），没有中间 CLI 层。

```
MCP 路径（Gemini、Claude Code、Codex 等 MCP 客户端）：
+--------------+  MCP/stdio  +---------------+  tmux API  +--------------+
|  MCP Agent   |<----------->|  tmux-bridge  |<---------->|  tmux 面板    |
+--------------+             |  MCP server   |            +--------------+
                             +---------------+

CLI 路径（Kimi）：
+--------------+  --print    +---------------+  tmux API  +--------------+
|  Kimi CLI    |<----------->|  kimi-tmux    |<---------->|  tmux 面板    |
+--------------+  tool parse |  adapter      |            +--------------+
                             +---------------+
```

![架构图](docs/images/architecture.png)

所有跨面板交互都遵循 **read-act-read** 工作流：

![Read-Act-Read 工作流](docs/images/read-act-read.png)

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | `tmux_read` | 读取目标面板（满足 read guard） |
| 2 | `tmux_message` / `tmux_type` | 输入消息或命令 |
| 3 | `tmux_read` | 验证文字已正确输入 |
| 4 | `tmux_keys` | 按回车提交 |
| -- | STOP | 不要轮询，对方 Agent 会直接回复到你的面板 |

Read guard 在 MCP 层强制执行：调用 `tmux_type`、`tmux_message`、`tmux_keys` 之前必须先对目标面板调用 `tmux_read`，否则会报错。

## 各 Agent 配置

### Gemini CLI（原生 MCP）

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

### Claude Code（原生 MCP）

添加到项目的 `.mcp.json` 或全局 MCP 配置：

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

### Codex（原生 MCP）

按照 Codex MCP 配置文档添加：

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

### Kimi CLI

**原生 MCP（推荐，v1.26+）：**

```bash
kimi mcp add tmux-bridge -- npx tmux-bridge-mcp
```

添加后，Kimi 可直接使用所有 tmux-bridge 工具，无需适配器。

**旧版封装器（不支持 MCP 的版本）：**

对于不支持原生 MCP 的旧版 Kimi CLI，`kimi-tmux` 会将 system instruction 注入为 prompt，以 `--print` 模式运行 Kimi，解析输出中的 tool call 并通过 tmux 执行。

```bash
kimi-tmux "列出所有 tmux 面板"
kimi-tmux "让 codex 面板 review src/auth.ts"
kimi-tmux "看看 claude 在做什么"
kimi-tmux --rounds 3 "给 gemini 发消息并等结果"
```

![Kimi CLI 桥接流程](docs/images/kimi-bridging.png)

## 工具参考

| 工具 | 说明 |
|------|------|
| `tmux_list` | 列出所有面板：target ID、进程、标签、工作目录 |
| `tmux_read` | 读取面板最后 N 行（满足 read guard） |
| `tmux_type` | 向面板输入文字，不按回车（需先 read） |
| `tmux_message` | 发送消息，自动附加发送者信息（需先 read） |
| `tmux_keys` | 发送特殊按键：Enter、Escape、C-c 等（需先 read） |
| `tmux_name` | 为面板设置标签（如 "claude"、"gemini"） |
| `tmux_resolve` | 通过标签查找面板 ID |
| `tmux_id` | 输出当前面板的 tmux ID |
| `tmux_doctor` | 诊断 tmux 连接问题 |

Target 可以是面板 ID（`%0`）、session:window.pane（`main:0.1`）或标签（`claude`）。

## 示例

### 让 Claude 审查文件（从 Gemini 发起）

```
tmux_list()
tmux_read(target="claude", lines=20)
tmux_message(target="claude", text="请审查 src/auth.ts 的安全问题")
tmux_read(target="claude", lines=5)
tmux_keys(target="claude", keys=["Enter"])
```

### 多 Agent 协作（从 Kimi 发起）

```bash
kimi-tmux "告诉 claude 面板跑一下测试套件"
kimi-tmux "让 gemini 总结 claude 面板的测试结果"
```

### 多 Agent 布局

```
+-----------------------------------------------------------+
| tmux 会话                                                  |
|                                                           |
| +------------+ +------------+ +----------+ +-----------+  |
| | Claude Code | |   Codex    | | Gemini   | |   Kimi    | |
| |  (MCP)     | |  (MCP)     | |  (MCP)   | |(kimi-tmux)| |
| |            | |            | |          | |           |  |
| | 标签:      | | 标签:      | | 标签:    | | 标签:     |  |
| | claude     | | codex      | | gemini   | | kimi      |  |
| +-----+------+ +-----+------+ +----+-----+ +-----+-----+ |
|       +---------------+-----------+--------------+        |
|          tmux-bridge（直接 tmux IPC，零外部依赖）           |
+-----------------------------------------------------------+
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `TMUX_BRIDGE_SOCKET` | 覆盖 tmux 服务器 socket 路径 | 从 `$TMUX` 自动检测 |
| `KIMI_PATH` | `kimi` 二进制路径（仅 kimi-tmux） | `kimi`（从 PATH） |

## System Instruction

对于支持自定义 system prompt 的 Agent，可使用 `system-instruction/smux-skill.md`。它包含 read-act-read 工作流说明和所有 MCP 工具的文档。

## 相关项目

| 项目 | 方式 | 重点 |
|------|------|------|
| [smux](https://github.com/ShawnPana/smux) | tmux skill + bash CLI | Agent 通用的 tmux 配置 |
| [agent-bridge](https://github.com/raysonmeng/agent-bridge) | WebSocket daemon + MCP 插件 | Claude Code <-> Codex |
| **tmux-bridge**（本项目） | 独立 MCP 服务器 + 直接 tmux | 任何 Agent，零外部依赖 |

## 许可证

MIT
