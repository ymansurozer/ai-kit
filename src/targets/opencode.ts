import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { installSkillsToDir } from "./shared";
import { log } from "../log";

export function installOpencode(
  skills: Skill[],
  mcps: McpConfig[],
  global: boolean,
  cwd: string,
): void {
  if (global) {
    installSkillsToDir(skills, join(homedir(), ".config", "opencode", "skills"), "~/.config/opencode/skills");
    installMcpsGlobal(mcps);
  } else {
    installSkillsToDir(skills, join(cwd, ".opencode", "skills"), ".opencode/skills");
    installMcpsLocal(mcps, cwd);
  }
}

export function convertMcpConfig(mcp: McpConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: "local",
    command: mcp.config.args
      ? [mcp.config.command, ...mcp.config.args]
      : [mcp.config.command],
  };
  if (mcp.config.env) {
    entry.environment = mcp.config.env;
  }
  return entry;
}

function installMcpsLocal(mcps: McpConfig[], cwd: string): void {
  if (mcps.length === 0) return;
  mergeMcpsJson(mcps, join(cwd, "opencode.json"), "opencode.json");
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) return;
  const configPath = join(homedir(), ".config", "opencode", "opencode.json");
  mkdirSync(join(homedir(), ".config", "opencode"), { recursive: true });
  mergeMcpsJson(mcps, configPath, "~/.config/opencode/opencode.json");
}

function mergeMcpsJson(
  mcps: McpConfig[],
  configPath: string,
  displayPath: string,
): void {
  let existing: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    existing = JSON.parse(readFileSync(configPath, "utf-8"));
  }

  if (!existing.mcp) existing.mcp = {};
  const servers = existing.mcp as Record<string, unknown>;

  for (const mcp of mcps) {
    servers[mcp.name] = convertMcpConfig(mcp);
    log.success(`Installed MCP ${mcp.name} → ${displayPath}`);
  }

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
}
