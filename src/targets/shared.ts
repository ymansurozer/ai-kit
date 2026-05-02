import { mkdirSync, cpSync, readdirSync } from "fs";
import { join, dirname } from "path";
import type { Skill } from "../config";
import { log } from "../log";

export function copySkillSubdirs(skillPath: string, dest: string): void {
  const skillDir = dirname(skillPath);
  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      cpSync(join(skillDir, entry.name), join(dest, entry.name), { recursive: true });
    }
  }
}

export function installSkillsToDir(skills: Skill[], dir: string, displayPrefix: string): void {
  for (const skill of skills) {
    const dest = join(dir, skill.name);
    mkdirSync(dest, { recursive: true });
    cpSync(skill.path, join(dest, "SKILL.md"));
    copySkillSubdirs(skill.path, dest);
    log.success(`Installed skill ${skill.name} → ${displayPrefix}/${skill.name}/SKILL.md`);
  }
}
