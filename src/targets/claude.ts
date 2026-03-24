import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { parseFrontmatter } from "../config";
import { installSkillsToDir } from "./shared";
import { mergeTargetConfig } from "./merge";
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
    installSkillsToDir(skills, join(cwd, ".agents", "skills"), ".agents/skills");
    installMcpsLocal(mcps, cwd);
  }
}

export function convertSkillToCommand(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const { data, body } = parseFrontmatter(normalized);
  const entries = Object.entries(data).filter(([key]) => key !== "name");
  if (entries.length === 0) return body;
  const lines = normalized.split("\n");
  const endIdx = lines.indexOf("---", 1);
  const kept = lines.slice(1, endIdx).filter((l) => {
    const key = l.slice(0, l.indexOf(":")).trim();
    return key !== "name";
  });
  return `---\n${kept.join("\n")}\n---\n${body}`;
}

function installSkillsGlobal(skills: Skill[]): void {
  const commandsDir = join(homedir(), ".claude", "commands");
  mkdirSync(commandsDir, { recursive: true });

  for (const skill of skills) {
    const content = readFileSync(skill.path, "utf-8");
    const output = convertSkillToCommand(content);

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
    servers[mcp.name] = mergeTargetConfig(servers[mcp.name], mcp.config, [
      "command",
      "args",
      "env",
      "url",
      "headers",
    ]);
    log.success(`Installed MCP ${mcp.name} → .mcp.json`);
  }

  writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n");
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) return;

  const claudeJsonPath = join(homedir(), ".claude.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(claudeJsonPath)) {
    existing = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
  }

  if (!existing.mcpServers) existing.mcpServers = {};
  const servers = existing.mcpServers as Record<string, unknown>;

  for (const mcp of mcps) {
    const type = "url" in mcp.config ? "http" : "stdio";
    servers[mcp.name] = mergeTargetConfig(
      servers[mcp.name],
      { ...mcp.config, type },
      ["type", "command", "args", "env", "url", "headers"],
    );
    log.success(`Installed MCP ${mcp.name} → ~/.claude.json`);
  }

  writeFileSync(claudeJsonPath, JSON.stringify(existing, null, 2) + "\n");
}
