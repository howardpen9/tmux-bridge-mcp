/**
 * Setup module tests — pure merge helpers and whichBinary.
 */
import { describe, it, expect } from "vitest";
import {
  mergeConfigJson,
  mergeOpenCodeConfig,
  mergeCopilotConfig,
  mergeGrokToml,
  stripJsoncComments,
  whichBinary,
  MCP_ENTRY,
  COPILOT_MCP_ENTRY,
  OPENCODE_MCP_ENTRY,
} from "../setup.js";

describe("mergeConfigJson", () => {
  it("creates new config when existing is undefined", () => {
    const result = mergeConfigJson(undefined);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers["tmux-bridge"]).toEqual({
      command: "npx",
      args: ["-y", "tmux-bridge-mcp"],
    });
  });

  it("creates new config when existing is empty string", () => {
    const result = mergeConfigJson("");
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["tmux-bridge"]).toBeDefined();
  });

  it("preserves existing mcpServers entries", () => {
    const existing = JSON.stringify({
      mcpServers: {
        other: { command: "other-cmd" },
      },
    });
    const result = mergeConfigJson(existing);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.other).toEqual({ command: "other-cmd" });
    expect(parsed.mcpServers["tmux-bridge"]).toEqual({
      command: "npx",
      args: ["-y", "tmux-bridge-mcp"],
    });
  });

  it("updates existing tmux-bridge entry without duplicating", () => {
    const existing = JSON.stringify({
      mcpServers: {
        "tmux-bridge": { command: "old-command" },
        other: { command: "keep-me" },
      },
    });
    const result = mergeConfigJson(existing);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["tmux-bridge"]).toEqual({
      command: "npx",
      args: ["-y", "tmux-bridge-mcp"],
    });
    expect(parsed.mcpServers.other).toEqual({ command: "keep-me" });
    expect(Object.keys(parsed.mcpServers)).toHaveLength(2);
  });

  it("preserves non-mcpServers keys in config", () => {
    const existing = JSON.stringify({
      someOtherKey: "value",
      mcpServers: {},
    });
    const result = mergeConfigJson(existing);
    const parsed = JSON.parse(result);
    expect(parsed.someOtherKey).toBe("value");
    expect(parsed.mcpServers["tmux-bridge"]).toBeDefined();
  });

  it("creates mcpServers key when missing from existing config", () => {
    const existing = JSON.stringify({ theme: "dark" });
    const result = mergeConfigJson(existing);
    const parsed = JSON.parse(result);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers["tmux-bridge"]).toBeDefined();
  });

  it("throws on invalid JSON", () => {
    expect(() => mergeConfigJson("{invalid json")).toThrow();
  });

  it("accepts custom entry object", () => {
    const custom = { command: "custom-cmd", args: ["--flag"] };
    const result = mergeConfigJson(undefined, custom);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["tmux-bridge"]).toEqual(custom);
  });

  it("output ends with newline", () => {
    const result = mergeConfigJson(undefined);
    expect(result.endsWith("\n")).toBe(true);
  });

  it("exports default MCP_ENTRY", () => {
    expect(MCP_ENTRY).toEqual({
      command: "npx",
      args: ["-y", "tmux-bridge-mcp"],
    });
  });
});

describe("stripJsoncComments", () => {
  it("strips line comments", () => {
    const input = '{\n  // comment\n  "a": 1\n}';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
  });

  it("strips block comments", () => {
    const input = '{ /* hi */ "a": 1 }';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
  });

  it("preserves // inside strings", () => {
    const input = '{ "url": "https://example.com" }';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({
      url: "https://example.com",
    });
  });
});

describe("mergeOpenCodeConfig", () => {
  it("creates mcp entry with local type and command array", () => {
    const result = mergeOpenCodeConfig(undefined);
    const parsed = JSON.parse(result);
    expect(parsed.mcp["tmux-bridge"]).toEqual(OPENCODE_MCP_ENTRY);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("preserves other mcp servers and top-level keys", () => {
    const existing = JSON.stringify({
      model: "x",
      mcp: { other: { type: "remote", url: "https://x" } },
    });
    const result = mergeOpenCodeConfig(existing);
    const parsed = JSON.parse(result);
    expect(parsed.model).toBe("x");
    expect(parsed.mcp.other).toEqual({ type: "remote", url: "https://x" });
    expect(parsed.mcp["tmux-bridge"]).toEqual(OPENCODE_MCP_ENTRY);
  });

  it("accepts JSONC with comments", () => {
    const existing = `{
  // default model
  "model": "foo",
  /* mcp block */
  "mcp": {}
}`;
    const result = mergeOpenCodeConfig(existing);
    const parsed = JSON.parse(result);
    expect(parsed.model).toBe("foo");
    expect(parsed.mcp["tmux-bridge"].enabled).toBe(true);
    expect(parsed.mcp["tmux-bridge"].command).toEqual([
      "npx",
      "-y",
      "tmux-bridge-mcp",
    ]);
  });

  it("updates existing tmux-bridge without duplicating", () => {
    const existing = JSON.stringify({
      mcp: { "tmux-bridge": { type: "local", command: ["old"], enabled: false } },
    });
    const result = mergeOpenCodeConfig(existing);
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed.mcp)).toEqual(["tmux-bridge"]);
    expect(parsed.mcp["tmux-bridge"]).toEqual(OPENCODE_MCP_ENTRY);
  });
});

describe("mergeCopilotConfig", () => {
  it("writes type=local and tools=*", () => {
    const result = mergeCopilotConfig(undefined);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers["tmux-bridge"]).toEqual(COPILOT_MCP_ENTRY);
  });

  it("preserves sibling servers", () => {
    const existing = JSON.stringify({
      mcpServers: {
        github: { type: "http", url: "https://api.githubcopilot.com/mcp/" },
      },
    });
    const result = mergeCopilotConfig(existing);
    const parsed = JSON.parse(result);
    expect(parsed.mcpServers.github).toBeDefined();
    expect(parsed.mcpServers["tmux-bridge"].tools).toEqual(["*"]);
  });
});

describe("mergeGrokToml", () => {
  it("appends block when file empty", () => {
    const result = mergeGrokToml(undefined);
    expect(result).toContain("[mcp_servers.tmux-bridge]");
    expect(result).toContain('command = "npx"');
    expect(result).toContain('"tmux-bridge-mcp"');
    expect(result).toContain("enabled = true");
  });

  it("preserves unrelated sections and replaces existing block", () => {
    const existing = `[cli]
installer = "internal"

[mcp_servers.tmux-bridge]
command = "old"
args = ["old"]
enabled = false

[ui]
theme = "auto"
`;
    const result = mergeGrokToml(existing);
    expect(result).toContain("[cli]");
    expect(result).toContain("[ui]");
    expect(result).toContain("theme = \"auto\"");
    expect(result).toContain('command = "npx"');
    expect(result).not.toContain('command = "old"');
    // only one tmux-bridge section
    expect(result.match(/\[mcp_servers\.tmux-bridge\]/g)?.length).toBe(1);
  });
});

describe("whichBinary", () => {
  it("returns true for a known binary (node)", async () => {
    const result = await whichBinary("node");
    expect(result).toBe(true);
  });

  it("returns false for a nonexistent binary", async () => {
    const result = await whichBinary("definitely-not-a-real-binary-xyz123");
    expect(result).toBe(false);
  });
});
