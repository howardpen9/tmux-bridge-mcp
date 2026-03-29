#!/usr/bin/env node
/**
 * kimi-adapter — Bridges Kimi CLI to tmux-bridge via text-based tool call parsing.
 *
 * Kimi CLI doesn't support MCP natively. This adapter:
 * 1. Injects the smux system instruction into Kimi's prompt
 * 2. Runs Kimi in --print mode
 * 3. Parses tool call blocks from Kimi's output (JSON preferred, function-call fallback)
 * 4. Executes them via tmux-bridge CLI
 * 5. Feeds results back with full transcript for multi-turn conversation
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as bridge from "./tmux-bridge.js";

const execFileAsync = promisify(execFile);

const KIMI_BIN = process.env.KIMI_PATH || "kimi";

// Match ``` tool blocks — each block can contain multiple calls (one per line)
const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)```/g;

// Per-line patterns inside a tool block
const FUNC_CALL_LINE_RE = /^(tmux_\w+)\((.*)?\)$/;
const JSON_LINE_RE = /^\s*[\[{]/;

interface ToolCall {
  name: string;
  args: Record<string, string | number | string[]>;
}

interface TranscriptEntry {
  role: "user" | "assistant" | "tool_results";
  content: string;
}

function parseToolCalls(output: string): ToolCall[] {
  const calls: ToolCall[] = [];

  TOOL_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_BLOCK_RE.exec(output)) !== null) {
    const block = match[1].trim();

    // Try parsing entire block as JSON first (single object or array)
    if (JSON_LINE_RE.test(block)) {
      try {
        const parsed = JSON.parse(block);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.name && item.args) calls.push(item);
          }
          continue;
        }
        if (parsed.name && parsed.args) {
          calls.push({ name: parsed.name, args: parsed.args });
          continue;
        }
      } catch {
        // Not valid JSON as a whole — try line-by-line below
      }
    }

    // Parse line-by-line: supports multiple calls per block
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // Try JSON per line
      if (JSON_LINE_RE.test(line)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.name && parsed.args) {
            calls.push({ name: parsed.name, args: parsed.args });
            continue;
          }
        } catch {
          process.stderr.write(`Warning: unparseable JSON tool call: ${line}\n`);
        }
      }

      // Try function-call style per line
      const funcMatch = FUNC_CALL_LINE_RE.exec(line);
      if (funcMatch) {
        const name = funcMatch[1];
        const argsStr = (funcMatch[2] || "").trim();
        const args = parseFuncArgs(argsStr);
        calls.push({ name, args });
        continue;
      }

      // If line looks like it was meant to be a tool call but didn't parse
      if (line.startsWith("tmux_")) {
        process.stderr.write(`Warning: could not parse tool call: ${line}\n`);
      }
    }
  }

  return calls;
}

function parseFuncArgs(argsStr: string): Record<string, string | number | string[]> {
  const args: Record<string, string | number | string[]> = {};
  if (!argsStr) return args;

  // Try to parse as JSON object if it looks like one (handles: target="x" → {"target": "x"})
  // Convert key=value to JSON: target="codex", lines=20 → {"target":"codex","lines":20}
  // Only replace single quotes used as string delimiters (around values), not apostrophes in text
  const jsonAttempt = "{" + argsStr
    .replace(/(\w+)\s*=\s*/g, '"$1": ')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
    + "}";
  try {
    const parsed = JSON.parse(jsonAttempt);
    for (const [k, v] of Object.entries(parsed)) {
      args[k] = v as string | number | string[];
    }
    return args;
  } catch {
    // Fall through to regex parsing
  }

  // Regex fallback for key=value pairs
  const ARG_RE = /(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[\s\S]*?\]|\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = ARG_RE.exec(argsStr)) !== null) {
    const key = m[1];
    const val = m[2];

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      args[key] = val.slice(1, -1);
    } else if (val.startsWith("[")) {
      try {
        args[key] = JSON.parse(val);
      } catch {
        process.stderr.write(`Warning: could not parse array arg "${key}": ${val}\n`);
        args[key] = val;
      }
    } else {
      const num = Number(val);
      args[key] = Number.isNaN(num) ? val : num;
    }
  }

  return args;
}

async function executeToolCall(call: ToolCall): Promise<string> {
  const { name, args } = call;

  try {
    switch (name) {
      case "tmux_list": {
        const panes = await bridge.list();
        return panes
          .map((p) => `${p.target} | ${p.sessionWindow} | ${p.process} | label:${p.label || "(none)"} | ${p.cwd}`)
          .join("\n") || "(no panes)";
      }
      case "tmux_read":
        if (!args.target) return "Error: tmux_read requires 'target' argument";
        return await bridge.read(String(args.target), Number(args.lines) || 50);
      case "tmux_type":
        if (!args.target) return "Error: tmux_type requires 'target' argument";
        if (args.text == null) return "Error: tmux_type requires 'text' argument";
        await bridge.type(String(args.target), String(args.text));
        return `Typed into ${args.target}`;
      case "tmux_message":
        if (!args.target) return "Error: tmux_message requires 'target' argument";
        if (args.text == null) return "Error: tmux_message requires 'text' argument";
        await bridge.message(String(args.target), String(args.text));
        return `Message sent to ${args.target}`;
      case "tmux_keys":
        if (!args.target) return "Error: tmux_keys requires 'target' argument";
        if (!Array.isArray(args.keys) || args.keys.length === 0) return "Error: tmux_keys requires 'keys' array argument";
        await bridge.keys(String(args.target), ...args.keys.map(String));
        return `Sent keys to ${args.target}`;
      case "tmux_name":
        if (!args.target) return "Error: tmux_name requires 'target' argument";
        if (!args.label) return "Error: tmux_name requires 'label' argument";
        await bridge.name(String(args.target), String(args.label));
        return `Labeled ${args.target} as "${args.label}"`;
      case "tmux_resolve":
        if (!args.label) return "Error: tmux_resolve requires 'label' argument";
        return await bridge.resolve(String(args.label));
      case "tmux_id":
        return await bridge.id();
      case "tmux_doctor":
        return await bridge.doctor();
      default:
        return `Error: unknown tool "${name}"`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Tool error [${name}]: ${msg}\n`);
    return `Error: ${msg}`;
  }
}

async function loadSystemInstruction(): Promise<string> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  try {
    return await readFile(join(thisDir, "../system-instruction/smux-skill.md"), "utf-8");
  } catch {
    process.stderr.write("Warning: could not load system-instruction/smux-skill.md\n");
    return "";
  }
}

const TOOL_FORMAT_INSTRUCTION = `
When you need to use tmux-bridge tools, output them in a \`\`\`tool block.

Preferred (JSON):
\`\`\`tool
{"name": "tmux_read", "args": {"target": "codex", "lines": 20}}
\`\`\`

Also accepted (function-call):
\`\`\`tool
tmux_read(target="codex", lines=20)
\`\`\`

Multiple calls in one block (one per line):
\`\`\`tool
tmux_read(target="codex", lines=20)
tmux_list()
\`\`\`

After tool results are provided, continue your response based on them.`;

function buildPrompt(systemInstruction: string, transcript: TranscriptEntry[]): string {
  const parts: string[] = [];

  if (systemInstruction) {
    parts.push(`<system>\n${systemInstruction}\n${TOOL_FORMAT_INSTRUCTION}\n</system>`);
  }

  for (const entry of transcript) {
    switch (entry.role) {
      case "user":
        parts.push(`User: ${entry.content}`);
        break;
      case "assistant":
        parts.push(`Assistant: ${entry.content}`);
        break;
      case "tool_results":
        parts.push(`<tool_results>\n${entry.content}\n</tool_results>`);
        break;
    }
  }

  return parts.join("\n\n");
}

async function runKimi(prompt: string): Promise<string> {
  const { stdout } = await execFileAsync(KIMI_BIN, ["-p", prompt, "--print"], {
    timeout: 120_000,
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

async function runKimiWithToolLoop(userPrompt: string, maxRounds: number = 5): Promise<void> {
  const systemInstruction = await loadSystemInstruction();
  const transcript: TranscriptEntry[] = [{ role: "user", content: userPrompt }];

  for (let round = 0; round < maxRounds; round++) {
    const prompt = buildPrompt(
      round === 0 ? systemInstruction : "",
      transcript
    );

    const output = await runKimi(prompt);
    const toolCalls = parseToolCalls(output);

    // Always add assistant response to transcript
    transcript.push({ role: "assistant", content: output });

    if (toolCalls.length === 0) {
      // No tool calls — print final output (strip any stray tool blocks)
      TOOL_BLOCK_RE.lastIndex = 0;
      const cleanOutput = output.replace(TOOL_BLOCK_RE, "").trim();
      if (cleanOutput) {
        process.stdout.write(cleanOutput + "\n");
      }
      return;
    }

    // Print intermediate text (non-tool parts)
    TOOL_BLOCK_RE.lastIndex = 0;
    const intermediateOutput = output.replace(TOOL_BLOCK_RE, "").trim();
    if (intermediateOutput) {
      process.stdout.write(intermediateOutput + "\n");
    }

    // Execute tool calls and collect results
    const results: string[] = [];
    for (const call of toolCalls) {
      const result = await executeToolCall(call);
      results.push(`[${call.name}(${JSON.stringify(call.args)})] → ${result}`);
    }

    // Add tool results to transcript for next round
    transcript.push({ role: "tool_results", content: results.join("\n---\n") });
  }

  process.stderr.write("Warning: max tool call rounds reached\n");
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(`kimi-tmux — Bridge Kimi CLI to tmux-bridge for cross-pane agent communication

Usage:
  kimi-tmux <prompt>              Run Kimi with tmux-bridge tools
  kimi-tmux --rounds <n> <prompt> Set max tool call rounds (default: 5)

Environment:
  KIMI_PATH          Path to kimi binary (default: kimi)

Examples:
  kimi-tmux "list all tmux panes"
  kimi-tmux "ask the agent in codex pane to review src/auth.ts"
  kimi-tmux "read what claude is working on"`);
    process.exit(0);
  }

  let maxRounds = 5;
  let prompt: string;

  if (args[0] === "--rounds" && args.length >= 3) {
    maxRounds = parseInt(args[1], 10) || 5;
    prompt = args.slice(2).join(" ");
  } else {
    prompt = args.join(" ");
  }

  await runKimiWithToolLoop(prompt, maxRounds);
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
