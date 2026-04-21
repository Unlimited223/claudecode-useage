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

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "{}";
  }
}

function main() {
  readStdin();

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    console.log(`${DIM}Usage: no data yet${R}`);
    return;
  }

  const windows = cache.windows;
  if (!windows) {
    console.log(`${DIM}Usage: no data yet${R}`);
    return;
  }

  const labels = { "5h": "5H", "7d": "7D", "30d": "30D" };
  const lines = [];

  for (const [winName, winData] of Object.entries(windows)) {
    const label = labels[winName] || winName;
    const modelEntries = Object.entries(winData.models || {})
      .filter(([model]) => !model.startsWith("<"))
      .sort((a, b) => b[1].cost - a[1].cost);

    if (modelEntries.length === 0) {
      lines.push(`${B}${CYAN}${label}${R}${DIM}: --${R}`);
      continue;
    }

    const sep = ` ${DIM}|${R} `;
    const parts = modelEntries.map(([model, u]) => {
      const cc = costColor(u.cost);
      return `${shortModel(model)} ${cc}${fmtCost(u.cost)}${R}${DIM}(${fmtTokens(u.input + u.cacheRead)}in/${fmtTokens(u.output)}out)${R}`;
    });

    const tc = costColor(winData.totalCost);
    lines.push(
      `${B}${CYAN}${label}${R}: ${parts.join(sep)}  ${tc}${B}Total:${fmtCost(winData.totalCost)}${R}`
    );
  }

  for (const line of lines) {
    console.log(line);
  }
}

main();
