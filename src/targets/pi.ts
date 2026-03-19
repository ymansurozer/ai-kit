import { mkdirSync, cpSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { log } from "../log";

export function installPi(
  skills: Skill[],
  mcps: McpConfig[],
  global: boolean,
  cwd: string,
): void {
  if (global) {
    installSkillsGlobal(skills);
  } else {
    installSkillsLocal(skills, cwd);
  }

  if (mcps.length > 0) {
    log.warn("Pi does not support MCPs — skipping MCP installation");
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
    const dir = join(homedir(), ".pi", "agent", "skills", skill.name);
    mkdirSync(dir, { recursive: true });
    cpSync(skill.path, join(dir, "SKILL.md"));
    log.success(
      `Installed skill ${skill.name} → ~/.pi/agent/skills/${skill.name}/SKILL.md`,
    );
  }
}
