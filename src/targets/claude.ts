import { existsSync, writeFileSync, readdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

import type { Skill, McpConfig } from "../config";
import { parseJsonContent, readJsonFile } from "../json";
import { log } from "../log";
import { configRootFor } from "./descriptors";
import { mergeTargetConfig } from "./merge";
import { installSkillsToDir } from "./shared";

export function installClaude(skills: Skill[], mcps: McpConfig[], global: boolean, cwd: string): void {
  if (global) {
    installSkillsToDir(skills, join(configRootFor("claude", homedir()), "skills"), "~/.claude/skills");
    cleanupOldCommandLayout(skills);
    installMcpsGlobal(mcps);
  } else {
    installSkillsToDir(skills, join(cwd, ".agents", "skills"), ".agents/skills");
    installMcpsLocal(mcps, cwd);
  }
}

/**
 * Remove leftovers from the pre-skills global layout, which wrote each skill to
 * `~/.claude/commands/<name>.md` and flat-copied its sibling assets alongside.
 * For each skill in this run we delete only its own `<name>.md` plus the entry
 * names it contributes (top-level files and directories, everything except
 * SKILL.md and source.json) — hand-written command files are never touched.
 * Idempotent: `force: true` makes a second run a no-op.
 */
function cleanupOldCommandLayout(skills: Skill[]): void {
  const commandsDir = join(configRootFor("claude", homedir()), "commands");
  if (!existsSync(commandsDir)) {
    return;
  }

  let removed = 0;
  for (const skill of skills) {
    const names = [`${skill.name}.md`];
    for (const entry of readdirSync(dirname(skill.path))) {
      if (entry === "SKILL.md" || entry === "source.json") {
        continue;
      }
      names.push(entry);
    }
    for (const name of names) {
      const target = join(commandsDir, name);
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        removed++;
      }
    }
  }

  if (removed > 0) {
    log.info(`Removed ${removed} legacy skill ${removed === 1 ? "entry" : "entries"} from ~/.claude/commands/`);
  }
}

function installMcpsLocal(mcps: McpConfig[], cwd: string): void {
  if (mcps.length === 0) {
    return;
  }

  const mcpJsonPath = join(cwd, ".mcp.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(mcpJsonPath)) {
    existing = readJsonFile(mcpJsonPath) as Record<string, unknown>;
  }

  if (!existing.mcpServers) {
    existing.mcpServers = {};
  }
  const servers = existing.mcpServers as Record<string, unknown>;

  for (const mcp of mcps) {
    const type = "url" in mcp.config ? "http" : "stdio";
    servers[mcp.name] = mergeTargetConfig(servers[mcp.name], { ...mcp.config, type }, [
      "type",
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

/**
 * Delete the named MCP servers from the top-level `mcpServers` object of a Claude
 * MCP file (`.mcp.json` per-repo, `~/.claude.json` global), leaving every other
 * server entry and top-level key intact. Re-serialized with 2-space indent and a
 * trailing newline to match what the installers write. Used by orphan pruning:
 * hand-added servers whose names aren't in `names` survive. Returns `content`
 * unchanged when `names` is empty.
 */
export function stripClaudeMcpEntries(content: string, names: string[], sourcePath = ".mcp.json"): string {
  if (names.length === 0) {
    return content;
  }
  const parsed = parseJsonContent(content, sourcePath) as Record<string, unknown>;
  const servers = parsed.mcpServers;
  if (servers && typeof servers === "object" && !Array.isArray(servers)) {
    const map = servers as Record<string, unknown>;
    for (const name of names) {
      delete map[name];
    }
  }
  return JSON.stringify(parsed, null, 2) + "\n";
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) {
    return;
  }

  const claudeJsonPath = join(homedir(), ".claude.json");
  let existing: Record<string, unknown> = {};

  if (existsSync(claudeJsonPath)) {
    existing = readJsonFile(claudeJsonPath) as Record<string, unknown>;
  }

  if (!existing.mcpServers) {
    existing.mcpServers = {};
  }
  const servers = existing.mcpServers as Record<string, unknown>;

  for (const mcp of mcps) {
    const type = "url" in mcp.config ? "http" : "stdio";
    servers[mcp.name] = mergeTargetConfig(servers[mcp.name], { ...mcp.config, type }, [
      "type",
      "command",
      "args",
      "env",
      "url",
      "headers",
    ]);
    log.success(`Installed MCP ${mcp.name} → ~/.claude.json`);
  }

  writeFileSync(claudeJsonPath, JSON.stringify(existing, null, 2) + "\n");
}
