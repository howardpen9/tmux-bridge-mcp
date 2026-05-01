import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const execFileAsync = promisify(execFile);

// This is the regression test for the live bug encountered in
// codex-pair on 2026-04-26: when the bridge is spawned by an MCP
// client that doesn't propagate $TMUX_PANE, getSelfContext() must
// still recover the pane via the parent-process-tree walk.
//
// Skip when not running inside a tmux pane (the test machine isn't
// guaranteed to have tmux). The CI/local matrix that DOES have tmux
// gets the meaningful coverage.

const inTmux = process.env.TMUX_PANE !== undefined;
const describeIfTmux = inTmux ? describe : describe.skip;

const DIST = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
);

describeIfTmux("env-scrub integration", () => {
  it("getSelfContext recovers paneId when TMUX_PANE is unset in child env", async () => {
    // Spawn a node child with TMUX_PANE/TMUX cleared. The child's
    // PARENT (the test runner) does have those env vars set (we're
    // skipping otherwise), so the parent-walk should find them.
    const script = `
      import("${DIST}/tmux-bridge.js").then(async (m) => {
        try {
          const ctx = await m.getSelfContext();
          process.stdout.write(JSON.stringify({ ok: true, paneId: ctx.paneId, hasTmux: !!ctx.tmuxEnv }));
        } catch (e) {
          process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    `;

    const cleanEnv = { ...process.env };
    delete cleanEnv.TMUX_PANE;
    delete cleanEnv.TMUX;

    const { stdout } = await execFileAsync(
      "node",
      ["--input-type=module", "-e", script],
      { env: cleanEnv, timeout: 15_000 },
    );

    const result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
    // Codex's HIGH-1: not just paneId — recovered TMUX env too, so
    // tmux invocations target the right server.
    expect(result.paneId).toMatch(/^%\d+$/);
    expect(result.hasTmux).toBe(true);
  });

  it("tmux_message header reads concrete pane:%N (not 'unknown')", async () => {
    // Spawn a child with cleared env, have it call message() to a
    // benign target (its own discovered pane is fine — message()
    // refuses self, so we use the parent pane). Capture the header
    // it would emit by reading the implementation's intended output:
    // we verify the recovery, not the actual sending.
    //
    // Simplest assertion: getSelfContext().paneId is not the literal
    // string "unknown" — that's the bug Codex flagged in
    // tmux-bridge-mcp's message() pre-fix (Bridge-B).
    const script = `
      import("${DIST}/tmux-bridge.js").then(async (m) => {
        const ctx = await m.getSelfContext();
        process.stdout.write(ctx.paneId);
      });
    `;

    const cleanEnv = { ...process.env };
    delete cleanEnv.TMUX_PANE;
    delete cleanEnv.TMUX;

    const { stdout } = await execFileAsync(
      "node",
      ["--input-type=module", "-e", script],
      { env: cleanEnv, timeout: 15_000 },
    );

    expect(stdout.trim()).not.toBe("unknown");
    expect(stdout.trim()).toMatch(/^%\d+$/);
  });
});
