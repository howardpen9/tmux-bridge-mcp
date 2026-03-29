/**
 * tmux-bridge core — direct tmux interaction via child_process.
 * No external CLI dependencies (no smux, no tmux-bridge CLI).
 * Only requires `tmux` to be installed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

// --- Read Guard ---
// Enforces read-before-act: agents must read a pane before typing/keys.

const readGuardDir = join(tmpdir(), "tmux-bridge-guards");

function guardPath(paneId: string): string {
  return join(readGuardDir, paneId.replace(/%/g, "_"));
}

function markRead(paneId: string): void {
  try {
    if (!existsSync(readGuardDir)) {
      mkdirSync(readGuardDir, { recursive: true });
    }
    writeFileSync(guardPath(paneId), "", { flag: "w" });
  } catch {
    // Best-effort
  }
}

function requireRead(paneId: string): void {
  if (!existsSync(guardPath(paneId))) {
    throw new Error(
      `Must read pane ${paneId} before interacting. Call tmux_read first.`
    );
  }
}

function clearRead(paneId: string): void {
  try {
    unlinkSync(guardPath(paneId));
  } catch {
    // Already cleared
  }
}

// --- tmux socket detection ---

function detectSocketArgs(): string[] {
  const override = process.env.TMUX_BRIDGE_SOCKET;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`TMUX_BRIDGE_SOCKET=${override} is not a valid socket`);
    }
    return ["-S", override];
  }

  const tmuxEnv = process.env.TMUX;
  if (tmuxEnv) {
    const socket = tmuxEnv.split(",")[0];
    if (socket && existsSync(socket)) {
      return ["-S", socket];
    }
  }

  // Default tmux server
  return [];
}

async function tmux(...args: string[]): Promise<string> {
  const socketArgs = detectSocketArgs();
  const { stdout } = await execFileAsync("tmux", [...socketArgs, ...args], {
    timeout: 10_000,
    env: { ...process.env },
  });
  return stdout;
}

async function tmuxNoFail(...args: string[]): Promise<string> {
  try {
    return await tmux(...args);
  } catch {
    return "";
  }
}

// --- Target Resolution ---
// Supports: pane ID (%N), session:win.pane, label (@name), or pure number (window index)

async function resolveTarget(target: string): Promise<string> {
  // tmux pane ID like %0, %12
  if (/^%\d+$/.test(target)) return target;

  // session:win.pane or has dot
  if (target.includes(":") || target.includes(".")) return target;

  // Pure numeric — treat as window index
  if (/^\d+$/.test(target)) return target;

  // Otherwise resolve as @name label
  const output = await tmux(
    "list-panes",
    "-a",
    "-F",
    "#{pane_id} #{@name}"
  );
  for (const line of output.trim().split("\n")) {
    const [paneId, ...labelParts] = line.split(" ");
    const label = labelParts.join(" ");
    if (label === target) return paneId;
  }
  throw new Error(`No pane found with label '${target}'`);
}

async function validateTarget(target: string): Promise<void> {
  try {
    await tmux("display-message", "-t", target, "-p", "#{pane_id}");
  } catch {
    throw new Error(`Invalid target: ${target}`);
  }
}

async function getPaneId(target: string): Promise<string> {
  const output = await tmux(
    "display-message",
    "-t",
    target,
    "-p",
    "#{pane_id}"
  );
  return output.trim();
}

// --- Public API ---

export interface PaneInfo {
  target: string;
  sessionWindow: string;
  size: string;
  process: string;
  label: string;
  cwd: string;
}

export async function list(): Promise<PaneInfo[]> {
  const output = await tmux(
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}|#{session_name}:#{window_index}|#{pane_width}x#{pane_height}|#{pane_current_command}|#{@name}|#{pane_current_path}"
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [target, sessionWindow, size, cmd, label, cwd] =
        line.split("|");
      const home = process.env.HOME || "";
      return {
        target,
        sessionWindow,
        size,
        process: cmd || "?",
        label: label || "",
        cwd: home && cwd ? cwd.replace(home, "~") : (cwd || ""),
      };
    });
}

export async function read(target: string, lines: number = 50): Promise<string> {
  const resolved = await resolveTarget(target);
  await validateTarget(resolved);
  const paneId = await getPaneId(resolved);

  const output = await tmux(
    "capture-pane",
    "-t",
    resolved,
    "-p",
    "-J",
    "-S",
    `-${lines}`
  );

  markRead(paneId);
  return output;
}

export async function type(target: string, text: string): Promise<void> {
  const resolved = await resolveTarget(target);
  await validateTarget(resolved);
  const paneId = await getPaneId(resolved);
  requireRead(paneId);

  await tmux("send-keys", "-t", resolved, "-l", "--", text);
  clearRead(paneId);
}

export async function message(
  target: string,
  text: string
): Promise<void> {
  const resolved = await resolveTarget(target);
  await validateTarget(resolved);
  const paneId = await getPaneId(resolved);
  requireRead(paneId);

  // Detect sender identity
  const senderPane = process.env.TMUX_PANE || "unknown";
  const senderLabel = await tmuxNoFail(
    "display-message",
    "-t",
    senderPane,
    "-p",
    "#{@name}"
  );
  const from = senderLabel.trim() || senderPane;

  const header = `[tmux-bridge from:${from} pane:${senderPane}]`;
  await tmux("send-keys", "-t", resolved, "-l", "--", `${header} ${text}`);
  clearRead(paneId);
}

export async function keys(
  target: string,
  ...keyList: string[]
): Promise<void> {
  const resolved = await resolveTarget(target);
  await validateTarget(resolved);
  const paneId = await getPaneId(resolved);
  requireRead(paneId);

  for (const key of keyList) {
    await tmux("send-keys", "-t", resolved, key);
  }
  clearRead(paneId);
}

export async function name(target: string, label: string): Promise<void> {
  const resolved = await resolveTarget(target);
  await validateTarget(resolved);
  await tmux("set-option", "-p", "-t", resolved, "@name", label);
}

export async function resolve(label: string): Promise<string> {
  const output = await tmux(
    "list-panes",
    "-a",
    "-F",
    "#{pane_id} #{@name}"
  );
  for (const line of output.trim().split("\n")) {
    const [paneId, ...labelParts] = line.split(" ");
    if (labelParts.join(" ") === label) return paneId;
  }
  throw new Error(`No pane found with label '${label}'`);
}

export async function id(): Promise<string> {
  const pane = process.env.TMUX_PANE;
  if (!pane) throw new Error("Not running inside a tmux pane ($TMUX_PANE is unset)");
  return pane;
}

export async function doctor(): Promise<string> {
  const lines: string[] = ["tmux-bridge doctor", "---"];
  let hasErrors = false;

  lines.push(`TMUX_PANE:          ${process.env.TMUX_PANE || "<unset>"}`);
  lines.push(`TMUX:               ${process.env.TMUX || "<unset>"}`);
  lines.push(
    `TMUX_BRIDGE_SOCKET: ${process.env.TMUX_BRIDGE_SOCKET || "<unset>"}`
  );

  // Check tmux binary
  try {
    const ver = await tmux("-V");
    lines.push(`tmux version:       ${ver.trim()}`);
  } catch {
    lines.push(`tmux:               NOT FOUND`);
    lines.push("---");
    lines.push("Status: FAILED — tmux is not installed");
    return lines.join("\n");
  }

  // Socket detection
  lines.push("---");
  try {
    const socketArgs = detectSocketArgs();
    lines.push(
      `Socket:             ${socketArgs.length ? socketArgs[1] : "(default)"}`
    );
  } catch (e) {
    hasErrors = true;
    lines.push(`Socket:             FAILED — ${(e as Error).message}`);
  }

  // Pane count
  try {
    const output = await tmux("list-panes", "-a", "-F", "#{pane_id}");
    const count = output.trim().split("\n").filter(Boolean).length;
    lines.push(`Total panes:        ${count}`);

    const labeled = await tmux("list-panes", "-a", "-F", "#{@name}");
    const labeledCount = labeled
      .trim()
      .split("\n")
      .filter((l) => l.trim()).length;
    lines.push(`Labeled panes:      ${labeledCount}`);
  } catch {
    hasErrors = true;
    lines.push(`Panes:              unable to list`);
  }

  // Current pane visibility
  const pane = process.env.TMUX_PANE;
  if (pane) {
    try {
      await tmux("display-message", "-t", pane, "-p", "#{pane_id}");
      lines.push(`This pane (${pane}):  visible to server`);
    } catch {
      hasErrors = true;
      lines.push(`This pane (${pane}):  NOT visible to server`);
    }
  }

  lines.push("---");
  lines.push(hasErrors ? "Status: DEGRADED — some checks failed" : "Status: OK");
  return lines.join("\n");
}
