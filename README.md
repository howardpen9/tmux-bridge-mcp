# tmux-bridge

**English** | [简体中文](README.zh-CN.md)

A standalone MCP server that lets AI agents (Claude Code, Gemini CLI, Codex, Kimi CLI) communicate with each other through tmux panes. It talks directly to tmux -- no external dependencies beyond tmux itself.

## What is tmux?

[tmux](https://github.com/tmux/tmux) is a **terminal multiplexer** -- it lets you split one terminal window into multiple **panes**, each running its own process independently. Think of it as "tabs on steroids" for your terminal.

![What is tmux](docs/images/what-is-tmux.png)

```
+-------------------------------+
|  Pane 1       |  Pane 2       |
|  Claude Code  |  Codex        |
|  writing code |  reviewing    |
|               |               |
+---------------+---------------+
|  Pane 3       |  Pane 4       |
|  Gemini CLI   |  tail -f logs |
|  researching  |  monitoring   |
+-------------------------------+
```

Each pane is a full terminal. You can have Claude Code running in one, Codex in another, Gemini in a third -- all visible at the same time, all on the same machine.

**The problem:** these panes can't talk to each other. An agent in Pane 1 has no idea what's happening in Pane 2.

![The Problem](docs/images/the-problem.png)

**tmux-bridge fixes this.** It gives every agent the ability to read, type, and send messages into any other pane.

![The Solution](docs/images/the-solution.png)

## What can you do with tmux-bridge?

Once installed, your AI agents can:

| Action | How | Example |
|--------|-----|---------|
| **See what another agent is doing** | `tmux_read` | Read the last 20 lines of Codex's pane |
| **Send a task to another agent** | `tmux_message` + `tmux_keys` | Tell Claude to review a file |
| **Coordinate multi-agent workflows** | Chain tool calls | Gemini researches -> Claude implements -> Codex reviews |
| **Monitor processes** | `tmux_read` on a shell pane | Watch build logs, test output, server status |
| **Label panes by role** | `tmux_name` | Name panes "claude", "codex", "gemini" for easy targeting |

All of this happens through standard MCP tool calls -- your agent doesn't need to learn any new syntax. If it supports MCP, it already knows how.

## Supported Agents

![Supported Agents](docs/images/supported-agents.png)

### Tested and documented

| Agent | Connection | Status |
|-------|------------|--------|
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | Native MCP (stdio) | Supported |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | Native MCP (stdio) | Supported |
| [Codex CLI](https://github.com/openai/codex) | Native MCP (stdio) | Supported |
| [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) v1.26+ | Native MCP (`kimi mcp add`) | Supported |
| [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) older | Legacy wrapper (`kimi-tmux`) | Supported |

### Should work (any MCP-compatible agent)

| Agent | Notes |
|-------|-------|
| [Cursor](https://cursor.sh) | Supports MCP servers in settings |
| [Windsurf (Codeium)](https://codeium.com/windsurf) | MCP server support |
| [Copilot CLI](https://githubnext.com/projects/copilot-cli) | If MCP-compatible |
| [Aider](https://aider.chat) | Community MCP support |
| [Continue.dev](https://continue.dev) | MCP server support |
| [Cline](https://github.com/cline/cline) | VS Code extension with MCP |
| [Roo Code](https://github.com/RooVetGit/Roo-Code) | Fork of Cline with MCP |
| Any shell script or process | Read pane output with `tmux_read`, no MCP needed |

tmux-bridge works with **any agent that supports MCP over stdio**. If your agent isn't listed, try adding the MCP config -- it will likely just work.

## Why

When you run multiple AI agents in separate terminals, they work in isolation. You end up copy-pasting context between them, manually relaying questions and answers, or losing track of what each agent is doing.

tmux-bridge solves this by giving every agent the ability to **read, type, and send messages into any other terminal pane** -- programmatically, through standard MCP tool calls.

**Use cases:**

- **Code review pipeline** -- Claude Code writes code in one pane, Codex reviews it in another, results flow back automatically
- **Multi-model reasoning** -- ask Gemini for research, feed the findings to Claude, let Codex verify the implementation
- **Parallel workflows** -- multiple Claude Code instances each handling a different part of a large task, coordinating through pane messages
- **Monitoring** -- an agent reads log output from a `tail -f` pane and reacts to errors in real time

**What you need:**

| Requirement | Why |
|-------------|-----|
| **tmux** | The terminal multiplexer that hosts your panes -- this is the communication channel |
| **Node.js 18+** | Runs the MCP server |
| **At least one MCP-compatible agent** | Claude Code, Gemini CLI, Codex, or Kimi CLI v1.26+ |

If you already use tmux to run multiple agents side by side, tmux-bridge just makes them aware of each other.

## Quick Start

**1. Install tmux**

```bash
# macOS
brew install tmux

# Linux
apt install tmux   # or dnf install tmux
```

**2. Install tmux-bridge**

```bash
npm install -g @anthropic-fans/tmux-bridge
```

**3. Add to your agent's MCP config**

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

That's it. Your agent now has 9 MCP tools for reading, typing, and messaging across tmux panes.

## How It Works

![Layered Architecture](docs/images/layered-architecture.png)

tmux-bridge runs as an MCP server over stdio. It calls tmux directly (`capture-pane`, `send-keys`, `list-panes`, etc.) -- no intermediate CLI layer.

```
MCP path (Gemini, Claude Code, Codex, any MCP client):
+--------------+  MCP/stdio  +---------------+  tmux API  +--------------+
|  MCP Agent   |<----------->|  tmux-bridge  |<---------->|  tmux panes  |
+--------------+             |  MCP server   |            +--------------+
                             +---------------+

CLI path (Kimi):
+--------------+  --print    +---------------+  tmux API  +--------------+
|  Kimi CLI    |<----------->|  kimi-tmux    |<---------->|  tmux panes  |
+--------------+  tool parse |  adapter      |            +--------------+
                             +---------------+
```

![Architecture](docs/images/architecture.png)

All cross-pane interactions follow the **read-act-read** workflow:

![Read-Act-Read Workflow](docs/images/read-act-read.png)

| Step | Action | Purpose |
|------|--------|---------|
| 1 | `tmux_read` | Read target pane (satisfies read guard) |
| 2 | `tmux_message` / `tmux_type` | Type your message or command |
| 3 | `tmux_read` | Verify text landed correctly |
| 4 | `tmux_keys` | Press Enter to submit |
| -- | STOP | Don't poll. The other agent replies directly into your pane. |

The read guard is enforced at the MCP layer: `tmux_type`, `tmux_message`, and `tmux_keys` will fail unless you call `tmux_read` on the target pane first.

## Setup Per Agent

### Gemini CLI (native MCP)

Add to `~/.gemini/settings.json`:

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

### Claude Code (native MCP)

Add to your project's `.mcp.json` or global MCP config:

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

### Codex (native MCP)

Add to your MCP config following the Codex MCP setup docs:

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

**Native MCP (recommended, v1.26+):**

```bash
kimi mcp add tmux-bridge -- npx tmux-bridge-mcp
```

Once added, Kimi uses all tmux-bridge tools directly -- no adapter needed.

**Legacy wrapper (older versions):**

For Kimi CLI versions without native MCP, `kimi-tmux` bridges the gap by injecting the system instruction as a prompt, running Kimi in `--print` mode, parsing tool-call blocks from output, and executing them via tmux.

```bash
kimi-tmux "list all tmux panes"
kimi-tmux "ask the agent in codex pane to review src/auth.ts"
kimi-tmux "read what claude is working on"
kimi-tmux --rounds 3 "send a message to gemini and wait for the result"
```

![Kimi CLI Bridging](docs/images/kimi-bridging.png)

## Tools Reference

| Tool | Description |
|------|-------------|
| `tmux_list` | List all panes with target ID, process, label, and working directory |
| `tmux_read` | Read last N lines from a pane (satisfies read guard) |
| `tmux_type` | Type text into a pane without pressing Enter (requires prior read) |
| `tmux_message` | Send message with auto-prepended sender info (requires prior read) |
| `tmux_keys` | Send special keys -- Enter, Escape, C-c, etc. (requires prior read) |
| `tmux_name` | Label a pane for easy targeting (e.g., "claude", "gemini") |
| `tmux_resolve` | Look up pane ID by label |
| `tmux_id` | Print current pane's tmux ID |
| `tmux_doctor` | Diagnose tmux connectivity issues |

Targets can be a pane ID (`%0`), session:window.pane (`main:0.1`), or a label (`claude`).

## Examples

### Ask Claude to review a file (from Gemini)

```
tmux_list()
tmux_read(target="claude", lines=20)
tmux_message(target="claude", text="Please review src/auth.ts for security issues")
tmux_read(target="claude", lines=5)
tmux_keys(target="claude", keys=["Enter"])
```

### Multi-agent coordination (from Kimi)

```bash
kimi-tmux "tell the claude pane to run the test suite"
kimi-tmux "ask gemini to summarize the test results in claude's pane"
```

### Multi-agent layout

```
+-----------------------------------------------------------+
| tmux session                                              |
|                                                           |
| +------------+ +------------+ +----------+ +-----------+  |
| | Claude Code | |   Codex    | | Gemini   | |   Kimi    | |
| |  (MCP)     | |  (MCP)     | |  (MCP)   | |(kimi-tmux)| |
| |            | |            | |          | |           |  |
| | label:     | | label:     | | label:   | | label:    |  |
| | claude     | | codex      | | gemini   | | kimi      |  |
| +-----+------+ +-----+------+ +----+-----+ +-----+-----+ |
|       +---------------+-----------+--------------+        |
|           tmux-bridge (direct tmux IPC, no deps)          |
+-----------------------------------------------------------+
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TMUX_BRIDGE_SOCKET` | Override tmux server socket path | Auto-detected from `$TMUX` |
| `KIMI_PATH` | Path to `kimi` binary (kimi-tmux only) | `kimi` (in PATH) |

## System Instruction

For agents that support custom system prompts, use `system-instruction/smux-skill.md`. It teaches the read-act-read workflow and documents all available MCP tools.

## Related Projects

| Project | Approach | Focus |
|---------|----------|-------|
| [smux](https://github.com/ShawnPana/smux) | tmux skill + bash CLI | Agent-agnostic tmux setup |
| [agent-bridge](https://github.com/raysonmeng/agent-bridge) | WebSocket daemon + MCP plugin | Claude Code <-> Codex |
| **tmux-bridge** (this) | Standalone MCP server + direct tmux | Any agent, zero deps beyond tmux |

## License

MIT
