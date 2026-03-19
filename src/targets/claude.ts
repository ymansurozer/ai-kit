import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { parseFrontmatter } from "../config";
import { log } from "../log";

export function installClaude(
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
  const commandsDir = join(homedir(), ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });

  for (const skill of skills) {
    const content = readFileSync(skill.path, "utf-8");
    const { data, body } = parseFrontmatter(content);

    // Build new frontmatter without `name`
    const entries = Object.entries(data).filter(([key]) => key !== "name");
    const newFrontmatter = entries.map(([k, v]) => `${k}: ${v}`).join("\n");
    const output = newFrontmatter ? `---\n${newFrontmatter}\n---\n${body}` : body;

    const dest = join(commandsDir, `${skill.name}.md`);
    writeFileSync(dest, output);
    log.success(`Installed skill ${skill.name} → ~/.claude/commands/${skill.name}.md`);
  }
}

function installMcpsLocal(mcps: McpConfig[], cwd: string): void {
  if (mcps.length === 0) return;

  const mcpJsonPath = join(cwd, ".mcp.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(mcpJsonPath)) {
    existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
  }

  if (!existing.mcpServers) existing.mcpServers = {};
  const servers = existing.mcpServers as Record<string, unknown>;

  for (const mcp of mcps) {
    servers[mcp.name] = mcp.config;
    log.success(`Installed MCP ${mcp.name} → .mcp.json`);
  }

  writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n");
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) return;

  const settingsPath = join(homedir(), ".claude", "settings.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
  }

  if (!existing.mcpServers) existing.mcpServers = {};
  const servers = existing.mcpServers as Record<string, unknown>;

  for (const mcp of mcps) {
    servers[mcp.name] = mcp.config;
    log.success(`Installed MCP ${mcp.name} → ~/.claude/settings.json`);
  }

  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");
}
