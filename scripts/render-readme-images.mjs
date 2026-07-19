#!/usr/bin/env node
/**
 * Render README diagrams for tmux-bridge-mcp.
 *
 * Visual language mirrors x-watchlist (docs/design/design-system.md):
 * pure black canvas, zinc-stepped borders, single orange accent #F97316,
 * JetBrains Mono chrome. Logical canvas 1200×675 (16:9) @ 2× Retina,
 * except the hero banner which is 1200×360 (ultra-wide).
 *
 * Usage: node scripts/render-readme-images.mjs
 * Requires: @resvg/resvg-js, fonts in scripts/fonts/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(REPO, "docs", "images");
const FONTS_DIR = path.join(REPO, "scripts", "fonts");
const SCALE = 2;

const C = {
  bg: "#000000",
  surface: "#0A0A0A",
  card: "#111111",
  elevated: "#18181B",
  hover: "#27272A",
  border: "#27272A",
  borderSubtle: "#18181B",
  borderStrong: "#3F3F46",
  text: "#FFFFFF",
  secondary: "#A1A1AA",
  tertiary: "#71717A",
  disabled: "#3F3F46",
  accent: "#F97316",
  accentMuted: "rgba(249, 115, 22, 0.12)",
  rose: "#EF4444",
  roseMuted: "rgba(239, 68, 68, 0.12)",
  emerald: "#10B981",
};

const mono = "JetBrains Mono";

const FONT_FILES = [
  path.join(FONTS_DIR, "JetBrainsMono-Regular.ttf"),
  path.join(FONTS_DIR, "JetBrainsMono-Bold.ttf"),
];

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function frame(W, H, { title, subtitle, tag } = {}) {
  const header = title
    ? `
  <text x="64" y="72" font-family="${mono}" font-size="18" font-weight="700" fill="${C.accent}" letter-spacing="2">${esc(tag || "TMUX-BRIDGE")}</text>
  <text x="64" y="130" font-family="${mono}" font-size="42" font-weight="700" fill="${C.text}" letter-spacing="-1.2">${esc(title)}</text>
  ${
    subtitle
      ? `<text x="64" y="172" font-family="${mono}" font-size="20" fill="${C.secondary}">${esc(subtitle)}</text>`
      : ""
  }
  <line x1="64" y1="198" x2="${W - 64}" y2="198" stroke="${C.borderSubtle}" stroke-width="1"/>`
    : "";

  return `
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="${C.border}" stroke-width="3"/>
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${C.borderSubtle}" stroke-width="1"/>
  ${header}`;
}

function card(x, y, w, h, { accent = false, fill = C.card } = {}) {
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${accent ? C.accent : C.border}" stroke-width="${accent ? 1.5 : 1}"/>`;
}

function pill(x, y, label, { fill = C.elevated, color = C.secondary, border = C.border } = {}) {
  const padX = 14;
  const charW = 8.2;
  const w = Math.round(label.length * charW + padX * 2);
  const h = 30;
  return {
    w,
    svg: `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${border}" stroke-width="1"/>
  <text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-family="${mono}" font-size="13" font-weight="500" fill="${color}">${esc(label)}</text>`,
  };
}

function renderSvg(W, H, inner) {
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

function toPng(svg, W) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W * SCALE },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: mono,
    },
    background: C.bg,
  });
  return resvg.render().asPng();
}

function write(name, png) {
  const out = path.join(OUT, name);
  fs.writeFileSync(out, png);
  console.log("wrote", path.relative(REPO, out), `(${png.length} bytes)`);
}

// ── 1. Hero banner (ultra-wide) ──────────────────────────────────────────────
function hero() {
  const W = 1200,
    H = 360;
  const agents = ["Claude", "Codex", "OpenCode", "Grok", "Gemini", "Kimi", "Copilot"];
  let pills = "";
  let x = 64;
  for (const a of agents) {
    const p = pill(x, 268, a, {
      fill: C.elevated,
      color: C.secondary,
      border: C.border,
    });
    pills += p.svg;
    x += p.w + 10;
  }
  const accent = pill(x, 268, "Any MCP Agent", {
    fill: C.accentMuted,
    color: C.accent,
    border: C.accent,
  });
  pills += accent.svg;

  const svg = renderSvg(
    W,
    H,
    `
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="${C.border}" stroke-width="3"/>
  <rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="${C.borderSubtle}" stroke-width="1"/>

  <!-- left accent bar -->
  <rect x="14" y="14" width="4" height="${H - 28}" fill="${C.accent}"/>

  <text x="64" y="78" font-family="${mono}" font-size="15" font-weight="600" fill="${C.accent}" letter-spacing="2">MCP SERVER FOR TMUX</text>
  <text x="64" y="140" font-family="${mono}" font-size="40" font-weight="700" fill="${C.text}" letter-spacing="-1.5">tmux-bridge-mcp</text>
  <text x="64" y="188" font-family="${mono}" font-size="18" fill="${C.secondary}">Agents share context across panes — read, type, coordinate.</text>
  <text x="64" y="220" font-family="${mono}" font-size="16" fill="${C.tertiary}">Issue → Plan → Patch → PR  ·  pure stdio MCP  ·  no extra daemons</text>
  ${pills}

  <!-- right cluster: hub mark -->
  <g transform="translate(960, 90)">
    <rect x="0" y="0" width="160" height="160" rx="16" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
    <rect x="48" y="48" width="64" height="64" rx="10" fill="${C.accentMuted}" stroke="${C.accent}" stroke-width="1.5"/>
    <text x="80" y="86" text-anchor="middle" font-family="${mono}" font-size="22" font-weight="700" fill="${C.accent}">/tmb</text>
    <text x="80" y="140" text-anchor="middle" font-family="${mono}" font-size="13" fill="${C.tertiary}">bridge hub</text>
  </g>
  `,
  );
  write("hero-banner.png", toPng(svg, W));
}

// ── 2. What is tmux ──────────────────────────────────────────────────────────
function whatIsTmux() {
  const W = 1200,
    H = 675;
  const panes = [
    { label: "pane:claude", status: "writing auth.ts", x: 96, y: 268 },
    { label: "pane:codex", status: "reviewing PR", x: 612, y: 268 },
    { label: "pane:gemini", status: "research notes", x: 96, y: 448 },
    { label: "pane:shell", status: "tail -f logs", x: 612, y: 448 },
  ];
  const paneW = 492,
    paneH = 148;
  let body = `
  <!-- window chrome first -->
  <rect x="64" y="228" width="1072" height="392" rx="14" fill="${C.surface}" stroke="${C.borderStrong}" stroke-width="1.5"/>
  <rect x="64" y="228" width="1072" height="36" rx="14" fill="${C.elevated}"/>
  <rect x="64" y="248" width="1072" height="16" fill="${C.elevated}"/>
  <circle cx="88" cy="246" r="5" fill="${C.rose}"/>
  <circle cx="106" cy="246" r="5" fill="${C.accent}"/>
  <circle cx="124" cy="246" r="5" fill="${C.emerald}"/>
  <text x="148" y="251" font-family="${mono}" font-size="13" fill="${C.tertiary}">session: agents  ·  window 0</text>`;
  for (const p of panes) {
    body += `
  <rect x="${p.x}" y="${p.y}" width="${paneW}" height="${paneH}" rx="8" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <rect x="${p.x}" y="${p.y}" width="${paneW}" height="28" rx="8" fill="${C.elevated}"/>
  <rect x="${p.x}" y="${p.y + 18}" width="${paneW}" height="10" fill="${C.elevated}"/>
  <text x="${p.x + 16}" y="${p.y + 19}" font-family="${mono}" font-size="12" fill="${C.tertiary}">${esc(p.label)}</text>
  <text x="${p.x + 20}" y="${p.y + 72}" font-family="${mono}" font-size="17" font-weight="600" fill="${C.text}">$ ${esc(p.status)}</text>
  <text x="${p.x + 20}" y="${p.y + 104}" font-family="${mono}" font-size="14" fill="${C.disabled}">█</text>`;
  }

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "What is tmux?",
    subtitle: "One terminal, many independent panes — each running its own agent.",
    tag: "BASICS",
  })}
  ${body}
  `,
  );
  write("what-is-tmux.png", toPng(svg, W));
}

// ── 3. The Problem ───────────────────────────────────────────────────────────
function theProblem() {
  const W = 1200,
    H = 675;
  const agents = [
    { name: "Claude", initial: "CL", line1: "Writing auth.ts", line2: "Needs security review" },
    { name: "Codex", initial: "CX", line1: "Idle, waiting", line2: "Could be reviewing" },
    { name: "Gemini", initial: "GM", line1: "Has research data", line2: "No one asked for it" },
  ];
  let body = "";
  const cardW = 260,
    cardH = 240,
    gap = 90;
  const total = agents.length * cardW + (agents.length - 1) * gap;
  const startX = (W - total) / 2;
  agents.forEach((a, i) => {
    const x = startX + i * (cardW + gap);
    const y = 280;
    body += `
  ${card(x, y, cardW, cardH)}
  <rect x="${x + cardW / 2 - 28}" y="${y + 40}" width="56" height="56" rx="12" fill="${C.elevated}" stroke="${C.border}" stroke-width="1"/>
  <text x="${x + cardW / 2}" y="${y + 74}" text-anchor="middle" font-family="${mono}" font-size="16" font-weight="700" fill="${C.secondary}">${esc(a.initial)}</text>
  <text x="${x + cardW / 2}" y="${y + 130}" text-anchor="middle" font-family="${mono}" font-size="22" font-weight="700" fill="${C.text}">${esc(a.name)}</text>
  <text x="${x + cardW / 2}" y="${y + 168}" text-anchor="middle" font-family="${mono}" font-size="15" fill="${C.secondary}">${esc(a.line1)}</text>
  <text x="${x + cardW / 2}" y="${y + 196}" text-anchor="middle" font-family="${mono}" font-size="14" fill="${C.tertiary}">${esc(a.line2)}</text>`;
    if (i < agents.length - 1) {
      const mx = x + cardW + gap / 2;
      body += `
  <text x="${mx}" y="${y + cardH / 2 - 4}" text-anchor="middle" font-family="${mono}" font-size="26" font-weight="700" fill="${C.rose}">✕</text>
  <text x="${mx}" y="${y + cardH / 2 + 28}" text-anchor="middle" font-family="${mono}" font-size="11" fill="${C.rose}">no link</text>`;
    }
  });

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "The Problem",
    subtitle: "Agents work in isolation — no shared context across panes.",
    tag: "WHY",
  })}
  ${body}
  `,
  );
  write("the-problem.png", toPng(svg, W));
}

// ── 4. The Solution ──────────────────────────────────────────────────────────
function theSolution() {
  const W = 1200,
    H = 675;
  const left = [
    { name: "Claude", y: 260 },
    { name: "Codex", y: 370 },
    { name: "Grok", y: 480 },
  ];
  const right = [
    { name: "Gemini", y: 260 },
    { name: "OpenCode", y: 370 },
    { name: "Kimi", y: 480 },
  ];
  let body = `
  <!-- center hub -->
  <rect x="470" y="300" width="260" height="180" rx="14" fill="${C.card}" stroke="${C.accent}" stroke-width="1.5"/>
  <rect x="490" y="330" width="220" height="50" rx="8" fill="${C.accentMuted}"/>
  <text x="600" y="362" text-anchor="middle" font-family="${mono}" font-size="18" font-weight="700" fill="${C.accent}">tmux-bridge</text>
  <text x="600" y="410" text-anchor="middle" font-family="${mono}" font-size="14" fill="${C.secondary}">MCP · read · type · keys</text>
  <text x="600" y="440" text-anchor="middle" font-family="${mono}" font-size="13" fill="${C.tertiary}">loop-safe · pane-aware</text>`;

  for (const a of left) {
    body += `
  <rect x="80" y="${a.y}" width="200" height="72" rx="10" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="180" y="${a.y + 42}" text-anchor="middle" font-family="${mono}" font-size="18" font-weight="600" fill="${C.text}">${esc(a.name)}</text>
  <line x1="280" y1="${a.y + 36}" x2="470" y2="390" stroke="${C.accent}" stroke-width="1.5" stroke-opacity="0.55"/>
  <circle cx="280" cy="${a.y + 36}" r="4" fill="${C.accent}"/>`;
  }
  for (const a of right) {
    body += `
  <rect x="920" y="${a.y}" width="200" height="72" rx="10" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="1020" y="${a.y + 42}" text-anchor="middle" font-family="${mono}" font-size="18" font-weight="600" fill="${C.text}">${esc(a.name)}</text>
  <line x1="920" y1="${a.y + 36}" x2="730" y2="390" stroke="${C.accent}" stroke-width="1.5" stroke-opacity="0.55"/>
  <circle cx="920" cy="${a.y + 36}" r="4" fill="${C.accent}"/>`;
  }

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "The Solution",
    subtitle: "One MCP bridge — every agent can read, type, and message any pane.",
    tag: "HOW",
  })}
  ${body}
  `,
  );
  write("the-solution.png", toPng(svg, W));
}

// ── 5. Supported agents ──────────────────────────────────────────────────────
function supportedAgents() {
  const W = 1200,
    H = 675;
  const agents = [
    { name: "Claude Code", via: "claude mcp add" },
    { name: "Codex CLI", via: "codex mcp add" },
    { name: "OpenCode", via: "opencode.json" },
    { name: "Grok Build", via: "grok mcp add" },
    { name: "Gemini CLI", via: "settings.json" },
    { name: "Kimi CLI", via: "kimi mcp add" },
    { name: "CodeBuddy", via: "codebuddy mcp add" },
    { name: "Copilot CLI", via: "copilot mcp add" },
  ];
  const cols = 4;
  const cardW = 240,
    cardH = 120;
  const gapX = 24,
    gapY = 24;
  const gridW = cols * cardW + (cols - 1) * gapX;
  const startX = (W - gridW) / 2;
  const startY = 250;
  let body = "";
  agents.forEach((a, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    body += `
  ${card(x, y, cardW, cardH)}
  <circle cx="${x + 28}" cy="${y + 36}" r="8" fill="${C.accent}"/>
  <text x="${x + 48}" y="${y + 42}" font-family="${mono}" font-size="17" font-weight="700" fill="${C.text}">${esc(a.name)}</text>
  <text x="${x + 24}" y="${y + 82}" font-family="${mono}" font-size="13" fill="${C.tertiary}">stdio MCP</text>
  <text x="${x + 24}" y="${y + 104}" font-family="${mono}" font-size="13" fill="${C.secondary}">${esc(a.via)}</text>`;
  });

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "Supported Agents",
    subtitle: "Native MCP on the agents you already run — setup auto-detects them.",
    tag: "COMPAT",
  })}
  ${body}
  `,
  );
  write("supported-agents.png", toPng(svg, W));
}

// ── 6. Layered architecture ──────────────────────────────────────────────────
function layeredArchitecture() {
  const W = 1200,
    H = 675;
  const layers = [
    { name: "AI Agents", detail: "Claude · Codex · OpenCode · Grok · Gemini · Kimi · …", accent: false },
    { name: "MCP / stdio", detail: "Standard tool protocol — no custom agent SDK", accent: false },
    { name: "tmux-bridge-mcp", detail: "list · read · type · message · keys · name · doctor", accent: true },
    { name: "tmux", detail: "capture-pane · send-keys · list-panes · display-message", accent: false },
    { name: "Panes", detail: "Labeled targets: claude · codex · gemini · shell · …", accent: false },
  ];
  let body = "";
  const layerH = 64;
  const startY = 240;
  layers.forEach((L, i) => {
    const y = startY + i * (layerH + 16);
    const fill = L.accent ? C.accentMuted : C.card;
    const stroke = L.accent ? C.accent : C.border;
    const nameColor = L.accent ? C.accent : C.text;
    body += `
  <rect x="120" y="${y}" width="960" height="${layerH}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${L.accent ? 1.5 : 1}"/>
  <text x="152" y="${y + 28}" font-family="${mono}" font-size="18" font-weight="700" fill="${nameColor}">${esc(L.name)}</text>
  <text x="152" y="${y + 50}" font-family="${mono}" font-size="14" fill="${C.secondary}">${esc(L.detail)}</text>
  <text x="1040" y="${y + 38}" text-anchor="end" font-family="${mono}" font-size="14" fill="${C.tertiary}">L${i}</text>`;
    if (i < layers.length - 1) {
      body += `
  <line x1="600" y1="${y + layerH}" x2="600" y2="${y + layerH + 16}" stroke="${C.borderStrong}" stroke-width="1.5"/>`;
    }
  });

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "Layered Architecture",
    subtitle: "Thin stack: agents talk MCP, bridge talks tmux — nothing else in between.",
    tag: "STACK",
  })}
  ${body}
  `,
  );
  write("layered-architecture.png", toPng(svg, W));
}

// ── 7. Architecture routing ──────────────────────────────────────────────────
function architecture() {
  const W = 1200,
    H = 675;
  const leftAgents = ["Claude Code", "Codex CLI", "OpenCode", "Grok Build", "Gemini CLI", "Kimi CLI"];
  const panes = ["pane:claude", "pane:codex", "pane:gemini", "pane:kimi", "pane:shell"];

  let body = `
  <!-- left column -->
  <rect x="64" y="230" width="300" height="390" rx="12" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="88" y="268" font-family="${mono}" font-size="16" font-weight="700" fill="${C.secondary}">AI Agents</text>`;
  leftAgents.forEach((name, i) => {
    const y = 292 + i * 48;
    body += `
  <rect x="88" y="${y}" width="252" height="40" rx="8" fill="${C.elevated}" stroke="${C.borderSubtle}" stroke-width="1"/>
  <circle cx="112" cy="${y + 20}" r="5" fill="${C.accent}"/>
  <text x="130" y="${y + 25}" font-family="${mono}" font-size="14" fill="${C.text}">${esc(name)}</text>`;
  });

  body += `
  <!-- center -->
  <rect x="420" y="280" width="360" height="280" rx="14" fill="${C.card}" stroke="${C.accent}" stroke-width="1.5"/>
  <text x="600" y="320" text-anchor="middle" font-family="${mono}" font-size="16" font-weight="700" fill="${C.accent}">tmux-bridge core</text>
  <rect x="448" y="348" width="304" height="72" rx="10" fill="${C.accentMuted}" stroke="${C.accent}" stroke-width="1"/>
  <text x="600" y="380" text-anchor="middle" font-family="${mono}" font-size="16" font-weight="700" fill="${C.text}">MCP Server</text>
  <text x="600" y="404" text-anchor="middle" font-family="${mono}" font-size="12" fill="${C.secondary}">stdio · tool calls · read guard</text>
  <text x="600" y="448" text-anchor="middle" font-family="${mono}" font-size="20" fill="${C.accent}">↓</text>
  <rect x="448" y="468" width="304" height="60" rx="10" fill="${C.elevated}" stroke="${C.border}" stroke-width="1"/>
  <text x="600" y="494" text-anchor="middle" font-family="${mono}" font-size="15" font-weight="600" fill="${C.text}">kimi-tmux adapter</text>
  <text x="600" y="516" text-anchor="middle" font-family="${mono}" font-size="12" fill="${C.tertiary}">legacy non-MCP path</text>

  <!-- right -->
  <rect x="836" y="230" width="300" height="390" rx="12" fill="${C.card}" stroke="${C.border}" stroke-width="1"/>
  <text x="860" y="268" font-family="${mono}" font-size="16" font-weight="700" fill="${C.secondary}">tmux Panes</text>`;
  panes.forEach((name, i) => {
    const y = 300 + i * 52;
    body += `
  <rect x="860" y="${y}" width="252" height="40" rx="8" fill="${C.elevated}" stroke="${C.borderSubtle}" stroke-width="1"/>
  <text x="884" y="${y + 25}" font-family="${mono}" font-size="14" fill="${C.text}">${esc(name)}</text>`;
  });
  body += `
  <text x="860" y="590" font-family="${mono}" font-size="12" fill="${C.tertiary}">powered by tmux</text>

  <!-- flow arrows -->
  <line x1="364" y1="420" x2="420" y2="420" stroke="${C.accent}" stroke-width="1.5"/>
  <line x1="780" y1="420" x2="836" y2="420" stroke="${C.accent}" stroke-width="1.5"/>
  <polygon points="418,420 408,414 408,426" fill="${C.accent}"/>
  <polygon points="834,420 824,414 824,426" fill="${C.accent}"/>`;

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "How tmux-bridge routes agents",
    subtitle: "Official agent CLIs → bridge core → labeled panes.",
    tag: "ROUTING",
  })}
  ${body}
  `,
  );
  write("architecture.png", toPng(svg, W));
}

// ── 8. Read-Act-Read ─────────────────────────────────────────────────────────
function readActRead() {
  const W = 1200,
    H = 675;
  const steps = [
    { n: "01", title: "tmux_read", desc: "Observe target pane\n(satisfies read guard)" },
    { n: "02", title: "message / type", desc: "Send text or command\ninto the target pane" },
    { n: "03", title: "tmux_read", desc: "Verify it landed\nbefore submitting" },
    { n: "04", title: "tmux_keys", desc: "Press Enter / keys\nto submit" },
    { n: "—", title: "STOP", desc: "Don't poll. Reply\narrives in your pane." },
  ];
  let body = "";
  const cardW = 180,
    cardH = 220;
  const gap = 28;
  const total = steps.length * cardW + (steps.length - 1) * gap;
  const startX = (W - total) / 2;
  steps.forEach((s, i) => {
    const x = startX + i * (cardW + gap);
    const y = 280;
    const isStop = s.title === "STOP";
    body += `
  <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="12" fill="${C.card}" stroke="${isStop ? C.accent : C.border}" stroke-width="${isStop ? 1.5 : 1}"/>
  <text x="${x + 20}" y="${y + 40}" font-family="${mono}" font-size="14" font-weight="700" fill="${C.accent}">${esc(s.n)}</text>
  <text x="${x + 20}" y="${y + 90}" font-family="${mono}" font-size="16" font-weight="700" fill="${C.text}">${esc(s.title)}</text>`;
    s.desc.split("\n").forEach((line, li) => {
      body += `
  <text x="${x + 20}" y="${y + 130 + li * 24}" font-family="${mono}" font-size="13" fill="${C.secondary}">${esc(line)}</text>`;
    });
    if (i < steps.length - 1) {
      const ax = x + cardW + 6;
      body += `
  <text x="${ax + gap / 2 - 6}" y="${y + cardH / 2 + 6}" text-anchor="middle" font-family="${mono}" font-size="20" fill="${C.accent}">→</text>`;
    }
  });

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "Read → Act → Read",
    subtitle: "Every write is guarded: observe first, then act, then verify.",
    tag: "WORKFLOW",
  })}
  ${body}
  `,
  );
  write("read-act-read.png", toPng(svg, W));
}

// ── 9. Kimi bridging ─────────────────────────────────────────────────────────
function kimiBridging() {
  const W = 1200,
    H = 675;
  const boxes = [
    { title: "Kimi CLI", sub: "--print mode", x: 80 },
    { title: "kimi-tmux", sub: "parse tool calls", x: 340 },
    { title: "tmux-bridge", sub: "MCP / direct API", x: 600 },
    { title: "tmux panes", sub: "send-keys / capture", x: 860 },
  ];
  let body = "";
  boxes.forEach((b, i) => {
    const y = 320;
    const accent = i === 1 || i === 2;
    body += `
  <rect x="${b.x}" y="${y}" width="220" height="140" rx="12" fill="${C.card}" stroke="${accent ? C.accent : C.border}" stroke-width="${accent ? 1.5 : 1}"/>
  <text x="${b.x + 110}" y="${y + 60}" text-anchor="middle" font-family="${mono}" font-size="18" font-weight="700" fill="${accent ? C.accent : C.text}">${esc(b.title)}</text>
  <text x="${b.x + 110}" y="${y + 96}" text-anchor="middle" font-family="${mono}" font-size="14" fill="${C.secondary}">${esc(b.sub)}</text>`;
    if (i < boxes.length - 1) {
      body += `
  <text x="${b.x + 230}" y="${y + 78}" font-family="${mono}" font-size="22" fill="${C.accent}">→</text>`;
    }
  });

  body += `
  <rect x="80" y="500" width="1040" height="72" rx="10" fill="${C.elevated}" stroke="${C.border}" stroke-width="1"/>
  <text x="104" y="532" font-family="${mono}" font-size="14" fill="${C.tertiary}">v1.26+</text>
  <text x="180" y="532" font-family="${mono}" font-size="15" fill="${C.text}">Prefer native MCP:  kimi mcp add tmux-bridge -- npx -y tmux-bridge-mcp</text>
  <text x="104" y="556" font-family="${mono}" font-size="14" fill="${C.tertiary}">legacy</text>
  <text x="180" y="556" font-family="${mono}" font-size="14" fill="${C.secondary}">Older Kimi → kimi-tmux wrapper injects tools and executes via tmux</text>`;

  const svg = renderSvg(
    W,
    H,
    `
  ${frame(W, H, {
    title: "Kimi CLI bridging",
    subtitle: "Native MCP when available; legacy adapter otherwise.",
    tag: "KIMI",
  })}
  ${body}
  `,
  );
  write("kimi-bridging.png", toPng(svg, W));
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  for (const f of FONT_FILES) {
    if (!fs.existsSync(f)) {
      console.error("Missing font:", f);
      console.error("Copy JetBrains Mono into scripts/fonts/ first.");
      process.exit(1);
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  hero();
  whatIsTmux();
  theProblem();
  theSolution();
  supportedAgents();
  layeredArchitecture();
  architecture();
  readActRead();
  kimiBridging();
  console.log("\nDone. Images written to docs/images/");
}

main();
