#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PLUGINS_FILE = path.join(CLAUDE_DIR, "plugins", "installed_plugins.json");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
const CACHE_DIR = path.join(CLAUDE_DIR, "plugins", "data", "claudecode-useage");
const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PLUGIN_NAME = "claudecode-useage";
const PLUGIN_KEY = `${PLUGIN_NAME}@local`;

const uninstall = process.argv.includes("--uninstall");

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizePluginRoot() {
  return PLUGIN_ROOT.replace(/\\/g, "/");
}

import { execSync } from "node:child_process";

function installPlugin() {
  console.log("Installing claudecode-useage...\n");

  // 1. Register in installed_plugins.json
  const plugins = readJSON(PLUGINS_FILE) || { version: 2, plugins: {} };
  const entry = {
    scope: "user",
    installPath: normalizePluginRoot(),
    version: "1.0.0",
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    projectPath: null,
  };
  plugins.plugins[PLUGIN_KEY] = [entry];
  writeJSON(PLUGINS_FILE, plugins);
  console.log("  [OK] Registered plugin in installed_plugins.json");

  // 2. Configure statusLine in settings.json
  const settings = readJSON(SETTINGS_FILE) || {};
  const statuslineCmd = `node "${normalizePluginRoot()}/scripts/statusline.mjs"`;
  settings.statusLine = {
    type: "command",
    command: statuslineCmd,
    refreshInterval: 10,
  };
  writeJSON(SETTINGS_FILE, settings);
  console.log("  [OK] Configured statusLine in settings.json");

  // 3. Create cache directory
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log("  [OK] Created cache directory");

  // 4. Generate initial cache
  console.log("  [..] Generating initial usage cache...");
  try {
    execSync(`node "${path.join(PLUGIN_ROOT, "scripts", "usage-stats.mjs")}" --update-cache`, {
      stdio: "inherit",
    });
    console.log("  [OK] Initial cache generated");
  } catch {
    console.log("  [!!] Cache generation failed (will retry on next Claude response)");
  }

  console.log("\n  Installation complete!");
  console.log("  Restart Claude Code to activate the plugin.\n");
  console.log("  Usage:");
  console.log("    - Status line will auto-display at bottom of conversation");
  console.log("    - Type /claudecode-useage:usage for detailed report\n");
}

function uninstallPlugin() {
  console.log("Uninstalling claudecode-useage...\n");

  // 1. Remove from installed_plugins.json
  const plugins = readJSON(PLUGINS_FILE);
  if (plugins && plugins.plugins) {
    delete plugins.plugins[PLUGIN_KEY];
    writeJSON(PLUGINS_FILE, plugins);
    console.log("  [OK] Removed plugin from installed_plugins.json");
  }

  // 2. Remove statusLine from settings.json
  const settings = readJSON(SETTINGS_FILE);
  if (settings && settings.statusLine) {
    const cmd = settings.statusLine.command || "";
    if (cmd.includes("claudecode-useage")) {
      delete settings.statusLine;
      writeJSON(SETTINGS_FILE, settings);
      console.log("  [OK] Removed statusLine from settings.json");
    }
  }

  // 3. Remove cache
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    console.log("  [OK] Removed cache directory");
  }

  console.log("\n  Uninstallation complete!");
  console.log("  Restart Claude Code to apply changes.\n");
}

if (uninstall) {
  uninstallPlugin();
} else {
  installPlugin();
}
