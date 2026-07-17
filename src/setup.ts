import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/** Shared stdio MCP entry used by most agents (Claude / Gemini / Codex / …). */
export const MCP_ENTRY = {
  command: "npx",
  args: ["-y", "tmux-bridge-mcp"],
};

/** Copilot CLI expects type + tools fields. */
export const COPILOT_MCP_ENTRY = {
  type: "local",
  command: "npx",
  args: ["-y", "tmux-bridge-mcp"],
  tools: ["*"],
};

/** OpenCode uses a different key (`mcp`) and command-as-array shape. */
export const OPENCODE_MCP_ENTRY = {
  type: "local",
  command: ["npx", "-y", "tmux-bridge-mcp"],
  enabled: true,
};

interface AgentResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function whichBinary(name: string): Promise<boolean> {
  try {
    await execFileAsync("which", [name], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip // and /* *\/ comments for JSONC configs (OpenCode).
 * Not a full parser — good enough for typical agent config files.
 */
export function stripJsoncComments(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i++;
      continue;
    }

    // line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    // block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2; // skip */
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Pure merge logic: given existing JSON content (or undefined/empty for new file),
 * returns the merged JSON string with tmux-bridge entry under `mcpServers`.
 * Throws on invalid JSON.
 */
export function mergeConfigJson(
  existing: string | undefined,
  entry: Record<string, unknown> = MCP_ENTRY
): string {
  let config: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    config = JSON.parse(existing);
  }
  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }
  (config.mcpServers as Record<string, unknown>)["tmux-bridge"] = entry;
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Pure merge for OpenCode: entry goes under top-level `mcp` (not mcpServers),
 * and accepts JSONC (// and block comments).
 */
export function mergeOpenCodeConfig(
  existing: string | undefined,
  entry: Record<string, unknown> = OPENCODE_MCP_ENTRY
): string {
  let config: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== "") {
    config = JSON.parse(stripJsoncComments(existing));
  }
  if (!config.mcp || typeof config.mcp !== "object") {
    config.mcp = {};
  }
  (config.mcp as Record<string, unknown>)["tmux-bridge"] = entry;
  return JSON.stringify(config, null, 2) + "\n";
}

/**
 * Pure merge for Copilot CLI user config (~/.copilot/mcp-config.json).
 */
export function mergeCopilotConfig(
  existing: string | undefined,
  entry: Record<string, unknown> = COPILOT_MCP_ENTRY
): string {
  return mergeConfigJson(existing, entry);
}

/**
 * Pure TOML-ish merge for Grok: ensure a `[mcp_servers.tmux-bridge]` block exists.
 * If the block is already present, replace it; otherwise append.
 */
export function mergeGrokToml(
  existing: string | undefined,
  command = "npx",
  args: string[] = ["-y", "tmux-bridge-mcp"]
): string {
  const blockLines = [
    "[mcp_servers.tmux-bridge]",
    `command = ${JSON.stringify(command)}`,
    "args = [",
    ...args.map((a) => `    ${JSON.stringify(a)},`),
    "]",
    "enabled = true",
  ];

  const src = existing ?? "";
  if (!src.trim()) {
    return blockLines.join("\n") + "\n";
  }

  const lines = src.replace(/\s*$/, "").split("\n");
  const out: string[] = [];
  let i = 0;
  let replaced = false;

  while (i < lines.length) {
    const line = lines[i];
    if (/^\[mcp_servers\.tmux-bridge\]\s*$/.test(line)) {
      // skip this section until the next [header] or EOF
      i++;
      while (i < lines.length && !/^\[[^\]]+\]\s*$/.test(lines[i])) i++;
      // insert replacement once
      if (!replaced) {
        if (out.length > 0 && out[out.length - 1] !== "") out.push("");
        out.push(...blockLines);
        out.push("");
        replaced = true;
      }
      continue;
    }
    out.push(line);
    i++;
  }

  if (!replaced) {
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push(...blockLines);
    out.push("");
  }

  // collapse trailing blank lines to a single newline
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

function homePath(...parts: string[]): string {
  return join(homedir(), ...parts);
}

function detailPath(filePath: string): string {
  return filePath.replace(homedir(), "~");
}

async function backupIfExists(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(filePath, `${filePath}.backup-${ts}`);
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function writeMergedJson(
  filePath: string,
  agentName: string,
  merge: (existing: string | undefined) => string
): Promise<AgentResult> {
  try {
    await ensureParentDir(filePath);
    let existing: string | undefined;
    if (existsSync(filePath)) {
      existing = await readFile(filePath, "utf-8");
      await backupIfExists(filePath);
    }
    const merged = merge(existing);
    await writeFile(filePath, merged, "utf-8");
    return {
      name: agentName,
      ok: true,
      detail: `config written to ${detailPath(filePath)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name: agentName, ok: false, detail: msg };
  }
}

async function jsonMergeConfig(
  filePath: string,
  agentName: string,
  entry: Record<string, unknown> = MCP_ENTRY
): Promise<AgentResult> {
  return writeMergedJson(filePath, agentName, (existing) =>
    mergeConfigJson(existing, entry)
  );
}

function cliErrorDetail(e: unknown): string {
  if (e instanceof Error) {
    const err = e as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    return err.stderr || err.stdout || err.message;
  }
  return String(e);
}

// ── per-agent setup ──────────────────────────────────────────────────────────

async function setupClaudeCode(): Promise<AgentResult> {
  const name = "Claude Code (claude)";
  if (!(await whichBinary("claude"))) {
    return { name, ok: false, detail: "not found" };
  }
  // Prefer official CLI (user scope); fall back to ~/.claude.json merge.
  try {
    await execFileAsync(
      "claude",
      ["mcp", "add", "-s", "user", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 15_000 }
    );
    return { name, ok: true, detail: "added via claude mcp add -s user" };
  } catch {
    const configPath = homePath(".claude.json");
    return jsonMergeConfig(configPath, name);
  }
}

async function setupGemini(): Promise<AgentResult> {
  const name = "Gemini CLI (gemini)";
  if (!(await whichBinary("gemini"))) {
    return { name, ok: false, detail: "not found" };
  }
  const configPath = homePath(".gemini", "settings.json");
  return jsonMergeConfig(configPath, name);
}

async function setupCodex(): Promise<AgentResult> {
  const name = "Codex CLI (codex)";
  if (!(await whichBinary("codex"))) {
    return { name, ok: false, detail: "not found" };
  }
  try {
    await execFileAsync(
      "codex",
      ["mcp", "add", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 15_000 }
    );
    return { name, ok: true, detail: "added via codex mcp add" };
  } catch (e) {
    return { name, ok: false, detail: cliErrorDetail(e) };
  }
}

async function setupKimi(): Promise<AgentResult> {
  if (!(await whichBinary("kimi"))) {
    return { name: "Kimi CLI (kimi)", ok: false, detail: "not found" };
  }

  let version = "unknown";
  try {
    const { stdout } = await execFileAsync("kimi", ["--version"], { timeout: 5_000 });
    version = stdout.trim().replace(/^kimi\s*/i, "");
  } catch {
    // ignore
  }

  const name = `Kimi CLI v${version}`;

  const vMatch = version.match(/^(\d+)\.(\d+)/);
  if (vMatch) {
    const major = parseInt(vMatch[1], 10);
    const minor = parseInt(vMatch[2], 10);
    if (major < 1 || (major === 1 && minor < 26)) {
      return {
        name,
        ok: false,
        detail: `version ${version} < 1.26 — MCP not supported. Use kimi-tmux wrapper instead.`,
      };
    }
  }

  try {
    await execFileAsync(
      "kimi",
      ["mcp", "add", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 15_000 }
    );
    return { name, ok: true, detail: "added via kimi mcp add" };
  } catch (e) {
    return { name, ok: false, detail: cliErrorDetail(e) };
  }
}

async function setupOpenCode(): Promise<AgentResult> {
  const name = "OpenCode (opencode)";
  if (!(await whichBinary("opencode"))) {
    return { name, ok: false, detail: "not found" };
  }

  // Prefer ~/.config/opencode/opencode.jsonc, then .json (project global).
  // `opencode mcp add` is interactive — write config directly.
  const candidates = [
    homePath(".config", "opencode", "opencode.jsonc"),
    homePath(".config", "opencode", "opencode.json"),
    homePath(".opencode", "opencode.jsonc"),
    homePath(".opencode", "opencode.json"),
  ];
  const existing = candidates.find((p) => existsSync(p));
  const configPath = existing ?? candidates[1]; // default to ~/.config/opencode/opencode.json

  return writeMergedJson(configPath, name, (raw) => mergeOpenCodeConfig(raw));
}

/**
 * CodeBuddy (Tencent) — binary is `codebuddy`.
 * Also accept `codecodebuddy` alias if someone installs under that name.
 */
async function setupCodeBuddy(): Promise<AgentResult> {
  const name = "CodeBuddy (codebuddy)";
  let bin = "codebuddy";
  if (!(await whichBinary("codebuddy"))) {
    if (await whichBinary("codecodebuddy")) {
      bin = "codecodebuddy";
    } else {
      return { name, ok: false, detail: "not found" };
    }
  }

  try {
    await execFileAsync(
      bin,
      ["mcp", "add", "-s", "user", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 15_000 }
    );
    return { name, ok: true, detail: `added via ${bin} mcp add -s user` };
  } catch {
    // Fallback: write ~/.codebuddy/.mcp.json (user-level MCP file).
    const configPath = homePath(".codebuddy", ".mcp.json");
    return jsonMergeConfig(configPath, name);
  }
}

async function setupCopilot(): Promise<AgentResult> {
  const name = "GitHub Copilot CLI (copilot)";
  if (!(await whichBinary("copilot"))) {
    return { name, ok: false, detail: "not found" };
  }

  try {
    await execFileAsync(
      "copilot",
      ["mcp", "add", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 20_000 }
    );
    return { name, ok: true, detail: "added via copilot mcp add" };
  } catch {
    const configPath = homePath(".copilot", "mcp-config.json");
    return writeMergedJson(configPath, name, (raw) => mergeCopilotConfig(raw));
  }
}

async function setupGrok(): Promise<AgentResult> {
  const name = "Grok Build (grok)";
  if (!(await whichBinary("grok"))) {
    return { name, ok: false, detail: "not found" };
  }

  try {
    await execFileAsync(
      "grok",
      ["mcp", "add", "-s", "user", "tmux-bridge", "--", "npx", "-y", "tmux-bridge-mcp"],
      { timeout: 15_000 }
    );
    return { name, ok: true, detail: "added via grok mcp add -s user" };
  } catch {
    const configPath = homePath(".grok", "config.toml");
    try {
      await ensureParentDir(configPath);
      let existing: string | undefined;
      if (existsSync(configPath)) {
        existing = await readFile(configPath, "utf-8");
        await backupIfExists(configPath);
      }
      await writeFile(configPath, mergeGrokToml(existing), "utf-8");
      return {
        name,
        ok: true,
        detail: `config written to ${detailPath(configPath)}`,
      };
    } catch (e) {
      return { name, ok: false, detail: cliErrorDetail(e) };
    }
  }
}

export async function runSetup(): Promise<void> {
  console.log("tmux-bridge-mcp setup\n");
  console.log("Detecting agents...");

  const results = await Promise.all([
    setupClaudeCode(),
    setupCodex(),
    setupOpenCode(),
    setupCodeBuddy(),
    setupCopilot(),
    setupGrok(),
    // extras still supported
    setupGemini(),
    setupKimi(),
  ]);

  for (const r of results) {
    const icon = r.ok ? "\u2713" : "\u2717";
    console.log(`  ${icon} ${r.name} — ${r.detail}`);
  }

  const anyOk = results.some((r) => r.ok);
  console.log("");
  if (anyOk) {
    console.log("Setup complete! Restart your agents to activate tmux-bridge tools.");
    console.log("Run 'npx tmux-bridge-mcp demo' to see it in action.");
  } else {
    console.log("No agents were configured. Install at least one supported agent CLI first.");
  }
}
