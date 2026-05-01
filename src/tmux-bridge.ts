/**
 * tmux-bridge core — direct tmux interaction via child_process.
 * No external CLI dependencies (no smux, no tmux-bridge CLI).
 * Only requires `tmux` to be installed.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
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

export function markRead(paneId: string): void {
  try {
    if (!existsSync(readGuardDir)) {
      mkdirSync(readGuardDir, { recursive: true });
    }
    writeFileSync(guardPath(paneId), "", { flag: "w" });
  } catch {
    // Best-effort
  }
}

export function requireRead(paneId: string): void {
  if (!existsSync(guardPath(paneId))) {
    throw new Error(
      `Must read pane ${paneId} before interacting. Call tmux_read first.`
    );
  }
}

export function clearRead(paneId: string): void {
  try {
    unlinkSync(guardPath(paneId));
  } catch {
    // Already cleared
  }
}

// --- Self-context recovery ---
// When the bridge is spawned by an MCP client that doesn't propagate
// TMUX_PANE/TMUX (e.g. Codex CLI's MCP launcher), we still need to
// determine our own pane ID and the tmux server we belong to. Walk
// the parent process tree to find an ancestor that has the env vars
// set, then fall back to matching against `tmux list-panes`.

export type SelfContext = { paneId: string; tmuxEnv?: string };

let selfContextPromise: Promise<SelfContext | null> | null = null;
// Sync mirror so detectSocketArgs() (a sync function) can consult the
// recovered TMUX env without blocking. Populated by the same promise.
let selfContextResolved: SelfContext | null | undefined = undefined;

function ensureSelfContextWarmed(): Promise<SelfContext | null> {
  if (selfContextPromise === null) {
    selfContextPromise = computeSelfContext().then((ctx) => {
      selfContextResolved = ctx;
      return ctx;
    });
  }
  return selfContextPromise;
}

/** Test-only: reset the self-context cache so tests can re-exercise
 *  the recovery logic with different process.env arrangements. Not
 *  intended for production code paths.
 */
export function __resetSelfContextForTesting(): void {
  selfContextPromise = null;
  selfContextResolved = undefined;
}

async function computeSelfContext(): Promise<SelfContext | null> {
  // Fast path: env is set in our own process.
  if (process.env.TMUX_PANE) {
    return { paneId: process.env.TMUX_PANE, tmuxEnv: process.env.TMUX };
  }

  // Walk the parent process tree, collecting ancestor PIDs.
  // Unbounded — fixed-depth caps fail on double-fork / daemon launchers.
  // Cycle protection via `seen`. Stop at pid 1 (init) or pid 0.
  const ancestors: number[] = [];
  const seen = new Set<number>();
  let pid = process.pid;
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    ancestors.push(pid);
    try {
      const { stdout } = await execFileAsync(
        "ps",
        ["-o", "ppid=", "-p", String(pid)],
        { timeout: 5_000 },
      );
      const ppid = parseInt(stdout.trim(), 10);
      if (!Number.isFinite(ppid) || ppid <= 0 || ppid === pid) break;
      pid = ppid;
    } catch {
      break;
    }
  }

  // Read each ancestor's environment via `ps eww -p <pid>` (macOS) /
  // `/proc/<pid>/environ` (Linux). First ancestor with TMUX_PANE wins.
  for (const apid of ancestors) {
    const env = await readProcessEnv(apid);
    if (!env) continue;
    const tmuxPane = env.get("TMUX_PANE");
    if (tmuxPane) {
      return { paneId: tmuxPane, tmuxEnv: env.get("TMUX") };
    }
  }

  // Final fallback: query tmux directly and match ancestor PIDs against
  // pane PIDs. Use rawTmux (no socket detection) since we have no
  // recovered TMUX env at this point — this fallback only finds us if
  // we're on the default socket. Document this limitation by warning
  // when it succeeds without a recovered tmuxEnv.
  try {
    const out = await rawTmux(
      "list-panes",
      "-a",
      "-F",
      "#{pane_pid} #{pane_id}",
    );
    const panePidMap = new Map<number, string>();
    for (const line of out.split("\n")) {
      const [pidStr, paneId] = line.trim().split(/\s+/);
      const ppid = parseInt(pidStr ?? "", 10);
      if (Number.isFinite(ppid) && paneId?.startsWith("%")) {
        panePidMap.set(ppid, paneId);
      }
    }
    for (const apid of ancestors) {
      const match = panePidMap.get(apid);
      if (match) {
        // We recovered the pane ID, but not the TMUX env. If the user
        // is on a non-default socket, subsequent tmux calls will hit
        // the wrong server. Log loud once so this is diagnosable.
        // eslint-disable-next-line no-console
        console.error(
          `tmux-bridge: recovered self-pane ${match} via list-panes match (TMUX env not recovered; assuming default socket)`,
        );
        return { paneId: match };
      }
    }
  } catch {
    // Default socket has no panes, or tmux not available. Fall through
    // to null — public getSelfContext() will throw a clear error.
  }

  return null;
}

async function readProcessEnv(pid: number): Promise<Map<string, string> | null> {
  if (process.platform === "linux") {
    try {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(`/proc/${pid}/environ`);
      const env = new Map<string, string>();
      for (const entry of buf.toString("utf8").split("\0")) {
        const eq = entry.indexOf("=");
        if (eq > 0) env.set(entry.slice(0, eq), entry.slice(eq + 1));
      }
      return env;
    } catch {
      return null;
    }
  }
  // macOS / BSD: ps eww emits env vars space-separated after COMMAND.
  // TMUX_PANE (=%N) and TMUX (=/path,pid,N) values contain no spaces,
  // so a regex scan over the whole line is safe even though general
  // env values could contain spaces.
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["eww", "-o", "command=", "-p", String(pid)],
      { timeout: 5_000 },
    );
    const env = new Map<string, string>();
    // Match KEY=VALUE pairs where VALUE has no whitespace.
    const re = /(?:^|\s)([A-Z_][A-Z0-9_]*)=(\S*)/g;
    for (const m of stdout.matchAll(re)) {
      env.set(m[1], m[2]);
    }
    return env;
  } catch {
    return null;
  }
}

/** Public: resolve the bridge's own pane context. Throws if all
 *  recovery paths fail (genuinely outside tmux). Cached after first
 *  resolution so repeated calls are free.
 */
export async function getSelfContext(): Promise<SelfContext> {
  const ctx = await ensureSelfContextWarmed();
  if (!ctx) {
    throw new Error(
      "Not running inside a tmux pane ($TMUX_PANE is unset and " +
        "parent-process-tree walk found no tmux ancestor)",
    );
  }
  return ctx;
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

  // Direct env first; fall back to recovered context cache populated
  // by ensureSelfContextWarmed().
  let tmuxEnv = process.env.TMUX;
  if (!tmuxEnv && selfContextResolved && selfContextResolved.tmuxEnv) {
    tmuxEnv = selfContextResolved.tmuxEnv;
  }

  if (tmuxEnv) {
    const socket = tmuxEnv.split(",")[0];
    if (socket && existsSync(socket)) {
      return ["-S", socket];
    }
  }

  // Default tmux server
  return [];
}

/** Bypasses socket detection — used only inside computeSelfContext()
 *  to avoid recursion (the final list-panes fallback can't depend on
 *  socket recovery, since that's exactly what we're trying to recover).
 */
async function rawTmux(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: 10_000,
    env: { ...process.env },
  });
  return stdout;
}

async function tmux(...args: string[]): Promise<string> {
  // Warm the self-context cache so detectSocketArgs() can consult any
  // recovered TMUX env. First call walks parent processes; subsequent
  // calls are free.
  await ensureSelfContextWarmed();
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

// --- Loop Prevention ---

export function assertNotSelf(
  targetPaneId: string,
  selfPaneId: string | undefined,
  action: string,
): void {
  if (selfPaneId && targetPaneId === selfPaneId) {
    if (action === "message") {
      throw new Error("Cannot send message to your own pane (loop prevention)");
    }
    throw new Error("Cannot interact with your own pane");
  }
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
  // Resolve self via the recovery helper, not bare process.env.TMUX_PANE.
  // Throws if we're genuinely outside tmux — the right behavior, since
  // we couldn't act anyway.
  const { paneId: selfPaneId } = await getSelfContext();
  assertNotSelf(paneId, selfPaneId, "type");
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
  // Resolve self-context once: used for loop-prevention, the `from:`
  // label, and the `pane:` field of the bridge header. Recovers the
  // sender's pane ID even when $TMUX_PANE wasn't propagated to this
  // process — fixes "from:unknown pane:unknown" headers.
  const { paneId: senderPane } = await getSelfContext();
  assertNotSelf(paneId, senderPane, "message");
  requireRead(paneId);

  // Sender label: looked up by pane ID. tmuxNoFail handles the case
  // where the pane has no @name set (returns "" → fall back to pane ID).
  const senderLabel = await tmuxNoFail(
    "display-message",
    "-t",
    senderPane,
    "-p",
    "#{@name}"
  );
  const from = senderLabel.trim() || senderPane;

  const correlationId = randomUUID().slice(0, 8);
  const header = `[tmux-bridge from:${from} pane:${senderPane} id:${correlationId}]`;
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
  const { paneId: selfPaneId } = await getSelfContext();
  assertNotSelf(paneId, selfPaneId, "keys");
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
  // Use the recovery helper instead of bare process.env so the bridge
  // works when launched as an MCP subprocess that didn't inherit
  // $TMUX_PANE (e.g. Codex CLI's launcher). See getSelfContext().
  const { paneId } = await getSelfContext();
  return paneId;
}

// --- Sensible Defaults ---
// Applied at startup so tmux feels like a normal terminal out of the box.
// Uses runtime set-option (no file writes), safe to call multiple times.

export async function applyDefaults(): Promise<string[]> {
  const applied: string[] = [];

  const defaults: Array<[string[], string]> = [
    // Mouse scroll, click, and drag — feels like a normal terminal
    [["set-option", "-g", "mouse", "on"], "mouse on"],
    // Long scrollback so conversation history isn't lost
    [["set-option", "-g", "history-limit", "100000"], "history-limit 100000"],
    // Vi keys in copy mode for efficient scrolling (k/j, Ctrl-u/d, g/G)
    [["set-option", "-g", "mode-keys", "vi"], "mode-keys vi"],
  ];

  for (const [args, label] of defaults) {
    try {
      await tmux(...args);
      applied.push(label);
    } catch {
      // Non-fatal — keep going
    }
  }

  return applied;
}

export async function doctor(): Promise<string> {
  const lines: string[] = ["tmux-bridge doctor", "---"];
  let hasErrors = false;

  lines.push(`TMUX_PANE:          ${process.env.TMUX_PANE || "<unset>"}`);
  lines.push(`TMUX:               ${process.env.TMUX || "<unset>"}`);
  lines.push(
    `TMUX_BRIDGE_SOCKET: ${process.env.TMUX_BRIDGE_SOCKET || "<unset>"}`
  );

  // Surface recovered self-context (when env was unset, this is what
  // we walked the parent process tree to find). Helps diagnose whether
  // recovery worked and which path it took.
  if (!process.env.TMUX_PANE || !process.env.TMUX) {
    try {
      const ctx = await getSelfContext();
      lines.push(
        `recovered pane:     ${ctx.paneId}${ctx.tmuxEnv ? "" : " (TMUX env unrecovered — assuming default socket)"}`,
      );
      if (ctx.tmuxEnv) lines.push(`recovered TMUX:     ${ctx.tmuxEnv}`);
    } catch (e) {
      lines.push(`recovered pane:     <none — ${e instanceof Error ? e.message : String(e)}>`);
    }
  }

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

  // Show applied defaults
  lines.push("---");
  try {
    const mouse = (await tmuxNoFail("show-option", "-gv", "mouse")).trim();
    const histLimit = (await tmuxNoFail("show-option", "-gv", "history-limit")).trim();
    const modeKeys = (await tmuxNoFail("show-option", "-gv", "mode-keys")).trim();
    lines.push(`mouse:              ${mouse || "?"}`);
    lines.push(`history-limit:      ${histLimit || "?"}`);
    lines.push(`mode-keys:          ${modeKeys || "?"}`);
  } catch {
    lines.push(`Defaults:           unable to query`);
  }

  lines.push("---");
  lines.push(hasErrors ? "Status: DEGRADED — some checks failed" : "Status: OK");
  return lines.join("\n");
}
