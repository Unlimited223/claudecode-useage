#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

const PRICING = {
  "claude-opus-4-6":            { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-opus-4-7":            { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  "claude-sonnet-4-6":          { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-sonnet-4-5-20250929": { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  "claude-haiku-4-5-20251001":  { input: 0.80, output: 4,   cacheWrite: 1.00,  cacheRead: 0.08 },
};

const TIME_WINDOWS = {
  "5h":  5 * 60 * 60 * 1000,
  "7d":  7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const B = "\x1b[1m";
const R = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function getPricing(model) {
  if (PRICING[model]) return PRICING[model];
  for (const [key, val] of Object.entries(PRICING)) {
    if (model.startsWith(key.replace(/-\d{8}$/, ""))) return val;
  }
  return null;
}

function calcCost(usage, pricing) {
  if (!pricing) return 0;
  const mtok = 1_000_000;
  return (
    ((usage.input || 0) / mtok) * pricing.input +
    ((usage.output || 0) / mtok) * pricing.output +
    ((usage.cacheWrite || 0) / mtok) * pricing.cacheWrite +
    ((usage.cacheRead || 0) / mtok) * pricing.cacheRead
  );
}

function shortModel(model) {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
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

function costColor(cost) {
  if (cost < 1) return GREEN;
  if (cost < 10) return YELLOW;
  return RED;
}

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

async function parseSessionFile(filePath, cutoffMs) {
  const byMsgId = new Map();
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes('"type":"assistant"')) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "assistant") continue;
      const msg = obj.message;
      if (!msg || !msg.usage || !msg.model) continue;
      if (msg.model.startsWith("<")) continue;
      const ts = new Date(obj.timestamp).getTime();
      if (ts < cutoffMs) continue;
      const key = msg.id || obj.uuid;
      byMsgId.set(key, {
        model: msg.model,
        timestamp: ts,
        input: msg.usage.input_tokens || 0,
        output: msg.usage.output_tokens || 0,
        cacheWrite: msg.usage.cache_creation_input_tokens || 0,
        cacheRead: msg.usage.cache_read_input_tokens || 0,
      });
    } catch {}
  }
  return [...byMsgId.values()];
}

async function collectAllRecords() {
  const now = Date.now();
  const maxCutoff = now - TIME_WINDOWS["30d"];
  const allRecords = [];
  if (!fs.existsSync(PROJECTS_DIR)) return allRecords;
  const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(PROJECTS_DIR, d.name));
  for (const projDir of projects) {
    let files;
    try {
      files = fs.readdirSync(projDir).filter(f => f.endsWith(".jsonl")).map(f => path.join(projDir, f));
    } catch { continue; }
    for (const file of files) {
      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs < maxCutoff) continue;
        const records = await parseSessionFile(file, maxCutoff);
        allRecords.push(...records);
      } catch {}
    }
  }
  return allRecords;
}

function aggregate(records) {
  const now = Date.now();
  const result = {};
  for (const [winName, winMs] of Object.entries(TIME_WINDOWS)) {
    const cutoff = now - winMs;
    const models = {};
    let totalCost = 0;
    for (const r of records) {
      if (r.timestamp < cutoff) continue;
      if (!models[r.model]) {
        models[r.model] = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
      }
      const m = models[r.model];
      m.input += r.input;
      m.output += r.output;
      m.cacheWrite += r.cacheWrite;
      m.cacheRead += r.cacheRead;
    }
    for (const [model, usage] of Object.entries(models)) {
      usage.cost = calcCost(usage, getPricing(model));
      totalCost += usage.cost;
    }
    result[winName] = { models, totalCost };
  }
  return result;
}

function renderSessionLine(session) {
  const parts = [];
  const model = session.model?.display_name || session.model?.id;
  if (model) parts.push(`${B}${MAGENTA}${shortModel(model)}${R}`);
  const cost = session.cost?.total_cost_usd;
  if (cost != null) parts.push(`${costColor(cost)}${fmtCost(cost)}${R}`);
  const ctx = session.context_window;
  if (ctx) parts.push(`${ctxBar(ctx.used_percentage)} ${fmtPct(ctx.used_percentage)}`);
  const dur = session.cost?.total_duration_ms;
  if (dur) parts.push(`${DIM}${fmtDuration(dur)}${R}`);
  const added = session.cost?.total_lines_added || 0;
  const removed = session.cost?.total_lines_removed || 0;
  if (added || removed) parts.push(`${GREEN}+${added}${R}${DIM}/${R}${RED}-${removed}${R}`);
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

async function main() {
  const session = readStdin();
  const sessionLine = renderSessionLine(session);
  if (sessionLine) console.log(sessionLine);

  const records = await collectAllRecords();
  const windows = aggregate(records);
  for (const [winName, winData] of Object.entries(windows)) {
    console.log(renderWindowLine(winName, winData));
  }
}

main().catch(() => {});
