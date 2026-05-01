import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  assertNotSelf,
  getSelfContext,
  __resetSelfContextForTesting,
} from "../tmux-bridge.js";

// Loop-prevention: this is the bug Codex flagged in the threading
// review. Pre-fix, assertNotSelf read process.env.TMUX_PANE directly,
// so loop prevention silently disabled when env was scrubbed. Post-fix,
// the function takes selfPaneId as a parameter; the env-scrub case
// becomes the responsibility of getSelfContext (recovery). These tests
// pin the new contract.
describe("assertNotSelf (post-threading)", () => {
  it("throws when target equals self with action=message", () => {
    expect(() => assertNotSelf("%5", "%5", "message")).toThrow(
      /loop prevention/i,
    );
  });

  it("throws when target equals self with action=type", () => {
    expect(() => assertNotSelf("%5", "%5", "type")).toThrow(
      /Cannot interact with your own pane/i,
    );
  });

  it("does not throw when target differs from self", () => {
    expect(() => assertNotSelf("%5", "%7", "type")).not.toThrow();
    expect(() => assertNotSelf("%5", "%7", "message")).not.toThrow();
    expect(() => assertNotSelf("%5", "%7", "keys")).not.toThrow();
  });

  it("does not throw when self is undefined (recovery returned nothing)", () => {
    // This preserves the prior fall-through behavior for the case where
    // we genuinely cannot determine our own pane. The recovery helper
    // (getSelfContext) is responsible for throwing in that case before
    // assertNotSelf is reached — but the function itself stays defensive.
    expect(() => assertNotSelf("%5", undefined, "type")).not.toThrow();
  });
});

describe("getSelfContext (env fast path)", () => {
  // Snapshot/restore env to keep tests hermetic.
  const originalTmuxPane = process.env.TMUX_PANE;
  const originalTmux = process.env.TMUX;

  beforeEach(() => {
    __resetSelfContextForTesting();
  });

  afterAll(() => {
    if (originalTmuxPane !== undefined) {
      process.env.TMUX_PANE = originalTmuxPane;
    } else {
      delete process.env.TMUX_PANE;
    }
    if (originalTmux !== undefined) {
      process.env.TMUX = originalTmux;
    } else {
      delete process.env.TMUX;
    }
    __resetSelfContextForTesting();
  });

  it("returns env paneId immediately when TMUX_PANE is set", async () => {
    process.env.TMUX_PANE = "%42";
    process.env.TMUX = "/tmp/tmux-501/default,12345,0";
    const ctx = await getSelfContext();
    expect(ctx.paneId).toBe("%42");
    expect(ctx.tmuxEnv).toBe("/tmp/tmux-501/default,12345,0");
  });

  it("returns env paneId without TMUX env when TMUX_PANE alone is set", async () => {
    process.env.TMUX_PANE = "%99";
    delete process.env.TMUX;
    const ctx = await getSelfContext();
    expect(ctx.paneId).toBe("%99");
    expect(ctx.tmuxEnv).toBeUndefined();
  });

  it("caches the resolved value (second call doesn't re-walk)", async () => {
    process.env.TMUX_PANE = "%cached";
    const first = await getSelfContext();
    // Even if we mutate env after the first resolution, the cache wins.
    process.env.TMUX_PANE = "%mutated";
    const second = await getSelfContext();
    expect(second.paneId).toBe(first.paneId);
    expect(second.paneId).toBe("%cached");
  });
});
