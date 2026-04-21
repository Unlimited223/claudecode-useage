#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CACHE_FILE = path.join(
  os.homedir(), ".claude", "plugins", "data", "claudecode-useage", "usage-cache.json"
);

const B = "\x1b[1m";
const R = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const WHITE = "\x1b[37m";

function costColor(cost) {
  if (cost < 1) return GREEN;
  if (cost < 10) return YELLOW;
  return RED;
}

function shortModel(model) {
  return model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "");
}

function fmtTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtCost(n) {
  return "$" + n.toFixed(2);
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return "--";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return sec + "s";
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  if (min < 60) return min + "m" + (s > 0 ? s + "s" : "");
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + "h" + (m > 0 ? m + "m" : "");
}

function fmtPct(n) {
  if (n == null) return "--";
  return Math.round(n) + "%";
}

function ctxBar(pct) {
  if (pct == null) return "";
  const width = 10;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct < 50 ? GREEN : pct < 80 ? YELLOW : RED;
  return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${R}`;
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function renderSessionLine(session) {
  const parts = [];

  const model = session.model?.display_name || session.model?.id;
  if (model) {
    parts.push(`${B}${MAGENTA}${shortModel(model)}${R}`);
  }

  const cost = session.cost?.total_cost_usd;
  if (cost != null) {
    const cc = costColor(cost);
    parts.push(`${cc}${fmtCost(cost)}${R}`);
  }

  const ctx = session.context_window;
  if (ctx) {
    const pct = ctx.used_percentage;
    parts.push(`${ctxBar(pct)} ${fmtPct(pct)}`);
  }

  const dur = session.cost?.total_duration_ms;
  if (dur) {
    parts.push(`${DIM}${fmtDuration(dur)}${R}`);
  }

  const added = session.cost?.total_lines_added || 0;
  const removed = session.cost?.total_lines_removed || 0;
  if (added || removed) {
    parts.push(`${GREEN}+${added}${R}${DIM}/${R}${RED}-${removed}${R}`);
  }

  if (parts.length === 0) return null;
  return `${B}${CYAN}NOW${R}: ${parts.join("  ")}`;
}

function renderWindowLine(winName, winData) {
  const labels = { "5h": "5H", "7d": "7D", "30d": "30D" };
  const label = labels[winName] || winName;
  const modelEntries = Object.entries(winData.models || {})
    .filter(([m]) => !m.startsWith("<"))
    .sort((a, b) => b[1].cost - a[1].cost);

  if (modelEntries.length === 0) {
    return `${B}${CYAN}${label}${R}${DIM}: --${R}`;
  }

  const sep = ` ${DIM}|${R} `;
  const parts = modelEntries.map(([model, u]) => {
    const cc = costColor(u.cost);
    return `${shortModel(model)} ${cc}${fmtCost(u.cost)}${R}${DIM}(${fmtTokens(u.input + u.cacheRead)}in/${fmtTokens(u.output)}out)${R}`;
  });

  const tc = costColor(winData.totalCost);
  return `${B}${CYAN}${label}${R}: ${parts.join(sep)}  ${tc}${B}Total:${fmtCost(winData.totalCost)}${R}`;
}

function main() {
  const session = readStdin();

  const sessionLine = renderSessionLine(session);
  if (sessionLine) {
    console.log(sessionLine);
  }

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    if (!sessionLine) console.log(`${DIM}Usage: no data yet${R}`);
    return;
  }

  const windows = cache.windows;
  if (!windows) {
    if (!sessionLine) console.log(`${DIM}Usage: no data yet${R}`);
    return;
  }

  for (const [winName, winData] of Object.entries(windows)) {
    console.log(renderWindowLine(winName, winData));
  }
}

main();
