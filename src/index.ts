#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as bridge from "./tmux-bridge.js";

const server = new McpServer({
  name: "tmux-bridge",
  version: "0.3.1",
});

export function err(e: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const msg = e instanceof Error ? e.message : String(e);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

// --- Tools ---

server.tool(
  "tmux_list",
  "List all tmux panes with target ID, process, label, and working directory",
  {},
  async () => {
    try {
      const panes = await bridge.list();
      const text = panes
        .map(
          (p) =>
            `${p.target} | ${p.sessionWindow} | ${p.process} | label:${p.label || "(none)"} | ${p.cwd}`
        )
        .join("\n");
      return { content: [{ type: "text", text: text || "No panes found" }] };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_read",
  "Read the last N lines from a tmux pane. Must be called before type/keys (read guard). Target can be a pane ID (%N), session:window.pane, or a label.",
  {
    target: z.string().describe("Pane target: ID (%0), session:win.pane, or label"),
    lines: z
      .number()
      .optional()
      .default(50)
      .describe("Number of lines to read (default 50)"),
  },
  async ({ target, lines }) => {
    try {
      const output = await bridge.read(target, lines);
      return { content: [{ type: "text", text: output }] };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_type",
  "Type text into a tmux pane WITHOUT pressing Enter. You must tmux_read the pane first (read guard enforced). After typing, use tmux_read to verify, then tmux_keys to press Enter.",
  {
    target: z.string().describe("Pane target: ID (%0), session:win.pane, or label"),
    text: z.string().describe("Text to type into the pane"),
  },
  async ({ target, text }) => {
    try {
      await bridge.type(target, text);
      return { content: [{ type: "text", text: `Typed into ${target}` }] };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_message",
  "Send a message to another agent's pane with auto-prepended sender info, reply target, and correlation ID. Cannot message your own pane (loop prevention). Must tmux_read first.",
  {
    target: z.string().describe("Pane target: ID (%0), session:win.pane, or label"),
    text: z.string().describe("Message to send"),
  },
  async ({ target, text }) => {
    try {
      await bridge.message(target, text);
      return {
        content: [{ type: "text", text: `Message sent to ${target}` }],
      };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_keys",
  "Send special keys to a tmux pane (Enter, Escape, C-c, etc.). Must tmux_read first.",
  {
    target: z.string().describe("Pane target: ID (%0), session:win.pane, or label"),
    keys: z
      .array(z.string())
      .describe('Keys to send, e.g. ["Enter"], ["Escape"], ["C-c"]'),
  },
  async ({ target, keys }) => {
    try {
      await bridge.keys(target, ...keys);
      return {
        content: [
          { type: "text", text: `Sent keys [${keys.join(", ")}] to ${target}` },
        ],
      };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_name",
  "Label a tmux pane for easy addressing (e.g., 'gemini', 'claude'). The label appears in the tmux border.",
  {
    target: z.string().describe("Pane target: ID (%0) or session:win.pane"),
    label: z.string().describe("Label to assign"),
  },
  async ({ target, label }) => {
    try {
      await bridge.name(target, label);
      return {
        content: [{ type: "text", text: `Labeled ${target} as "${label}"` }],
      };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_resolve",
  "Look up a pane's target ID by its label",
  {
    label: z.string().describe("Label to resolve"),
  },
  async ({ label }) => {
    try {
      const target = await bridge.resolve(label);
      return { content: [{ type: "text", text: target }] };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_id",
  "Print the current pane's tmux ID ($TMUX_PANE). Useful for self-identification when labeling.",
  {},
  async () => {
    try {
      const paneId = await bridge.id();
      return { content: [{ type: "text", text: paneId }] };
    } catch (e) {
      return err(e);
    }
  }
);

server.tool(
  "tmux_doctor",
  "Diagnose tmux connectivity issues — checks socket, env vars, and pane visibility",
  {},
  async () => {
    try {
      const output = await bridge.doctor();
      return { content: [{ type: "text", text: output }] };
    } catch (e) {
      return err(e);
    }
  }
);

// --- Start ---

export async function startServer() {
  // Apply sensible tmux defaults (mouse scroll, long history, vi keys)
  // so users don't need to configure ~/.tmux.conf manually.
  bridge.applyDefaults().catch(() => {});

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only run when executed directly (not when imported for testing)
const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""));

if (isDirectRun) {
  startServer().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
