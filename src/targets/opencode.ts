import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  transformEnvVars,
  type Skill,
  type McpConfig,
  type StdioMcpTransportConfig,
  type HttpMcpTransportConfig,
} from "../config";
import { installSkillsToDir } from "./shared";
import { mergeTargetConfig } from "./merge";
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
  if ("url" in mcp.config && typeof mcp.config.url === "string") {
    const config = transformEnvVars(mcp.config, (varName) => `{env:${varName}}`) as HttpMcpTransportConfig;
    return {
      ...config,
      type: "remote",
    };
  }

  const config = transformEnvVars(
    mcp.config,
    (varName) => `{env:${varName}}`,
  ) as StdioMcpTransportConfig;
  const entry: Record<string, unknown> = {
    ...config,
    type: "local",
    command: config.args ? [config.command, ...config.args] : [config.command],
  };
  if (config.env) {
    entry.environment = config.env;
    delete entry.env;
  }
  delete entry.args;
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
    servers[mcp.name] = mergeTargetConfig(
      servers[mcp.name],
      convertMcpConfig(mcp),
      ["type", "command", "environment", "url", "headers"],
    );
    log.success(`Installed MCP ${mcp.name} → ${displayPath}`);
  }

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
}
