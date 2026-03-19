import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { log } from "../log";

export function installCodex(
  skills: Skill[],
  mcps: McpConfig[],
  global: boolean,
  cwd: string,
): void {
  if (global) {
    installSkillsGlobal(skills);
    installMcpsGlobal(mcps);
  } else {
    installSkillsLocal(skills, cwd);
    installMcpsLocal(mcps, cwd);
  }
}

function installSkillsLocal(skills: Skill[], cwd: string): void {
  for (const skill of skills) {
    const dir = join(cwd, ".agents", "skills", skill.name);
    mkdirSync(dir, { recursive: true });
    cpSync(skill.path, join(dir, "SKILL.md"));
    log.success(`Installed skill ${skill.name} → .agents/skills/${skill.name}/SKILL.md`);
  }
}

function installSkillsGlobal(skills: Skill[]): void {
  for (const skill of skills) {
    const dir = join(homedir(), ".agents", "skills", skill.name);
    mkdirSync(dir, { recursive: true });
    cpSync(skill.path, join(dir, "SKILL.md"));
    log.success(`Installed skill ${skill.name} → ~/.agents/skills/${skill.name}/SKILL.md`);
  }
}

function installMcpsLocal(mcps: McpConfig[], cwd: string): void {
  if (mcps.length === 0) return;
  const configPath = join(cwd, ".codex", "config.toml");
  mergeMcpsToml(mcps, configPath, ".codex/config.toml");
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) return;
  const configPath = join(homedir(), ".codex", "config.toml");
  mergeMcpsToml(mcps, configPath, "~/.codex/config.toml");
}

function mergeMcpsToml(
  mcps: McpConfig[],
  configPath: string,
  displayPath: string,
): void {
  mkdirSync(dirname(configPath), { recursive: true });

  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
  }

  for (const mcp of mcps) {
    content = removeTomlSection(content, `mcp_servers.${mcp.name}`);
    const section = buildTomlSection(mcp);
    content = content.trimEnd() + (content.trim() ? "\n\n" : "") + section;
    log.success(`Installed MCP ${mcp.name} → ${displayPath}`);
  }

  writeFileSync(configPath, content.trimEnd() + "\n");
}

export function removeTomlSection(content: string, sectionPrefix: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      const closeBracket = trimmed.indexOf("]");
      const sectionName = trimmed.slice(1, closeBracket);
      if (
        sectionName === sectionPrefix ||
        sectionName.startsWith(sectionPrefix + ".")
      ) {
        skipping = true;
        continue;
      } else {
        skipping = false;
      }
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export function buildTomlSection(mcp: McpConfig): string {
  let section = `[mcp_servers.${mcp.name}]\n`;
  section += `command = ${tomlString(mcp.config.command)}\n`;

  if (mcp.config.args) {
    section += `args = [${mcp.config.args.map(tomlString).join(", ")}]\n`;
  }

  if (mcp.config.env) {
    section += `\n[mcp_servers.${mcp.name}.env]\n`;
    for (const [key, value] of Object.entries(mcp.config.env)) {
      section += `${key} = ${tomlString(value)}\n`;
    }
  }

  return section;
}

export function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
