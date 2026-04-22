#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const CACHE_DIR = path.join(CLAUDE_DIR, "plugins", "data", "claudecode-useage");
const CACHE_FILE = path.join(CACHE_DIR, "usage-cache.json");

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
    const files = fs.readdirSync(projDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => path.join(projDir, f));

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
      const pricing = getPricing(model);
      usage.cost = calcCost(usage, pricing);
      totalCost += usage.cost;
    }

    result[winName] = { models, totalCost };
  }
  return result;
}

function writeCache(windows) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const data = { updatedAt: new Date().toISOString(), windows };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function printDetailedTable(windows) {
  const B = "\x1b[1m";
  const R = "\x1b[0m";
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const WHITE = "\x1b[37m";

  function costColor(cost) {
    if (cost < 1) return GREEN;
    if (cost < 10) return YELLOW;
    return RED;
  }

  function pad(s, n) { return String(s).padEnd(n); }
  function rpad(s, n) { return String(s).padStart(n); }

  const labels = { "5h": "Last 5 Hours", "7d": "Last 7 Days", "30d": "Last 30 Days" };
  const line = DIM + "─".repeat(78) + R;

  console.log("");
  console.log(`${B}${CYAN}  Claude Code Usage Statistics${R}`);
  console.log(line);

  for (const [winName, winData] of Object.entries(windows)) {
    const modelEntries = Object.entries(winData.models)
      .sort((a, b) => b[1].cost - a[1].cost);

    console.log(`${B}  ${labels[winName]}${R}`);

    if (modelEntries.length === 0) {
      console.log(`  ${DIM}No usage data${R}`);
    } else {
      console.log(
        `  ${DIM}${pad("Model", 22)} ${rpad("Input", 10)} ${rpad("Output", 10)} ${rpad("Cache W", 10)} ${rpad("Cache R", 10)} ${rpad("Cost", 10)}${R}`
      );
      for (const [model, u] of modelEntries) {
        const cc = costColor(u.cost);
        console.log(
          `  ${WHITE}${pad(shortModel(model), 22)}${R} ${rpad(fmtTokens(u.input), 10)} ${rpad(fmtTokens(u.output), 10)} ${rpad(fmtTokens(u.cacheWrite), 10)} ${rpad(fmtTokens(u.cacheRead), 10)} ${cc}${rpad(fmtCost(u.cost), 10)}${R}`
        );
      }
      const tc = costColor(winData.totalCost);
      console.log(`  ${pad("", 62)} ${B}${tc}${rpad("Total: " + fmtCost(winData.totalCost), 10)}${R}`);
    }
    console.log(line);
  }
  console.log("");
}

async function main() {
  const args = process.argv.slice(2);
  const updateCache = args.includes("--update-cache");
  const verbose = args.includes("--verbose");

  const records = await collectAllRecords();
  const windows = aggregate(records);

  if (updateCache) {
    writeCache(windows);
    return;
  }

  printDetailedTable(windows);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
