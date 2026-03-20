import { mkdirSync, cpSync } from "fs";
import { join } from "path";
import type { Skill } from "../config";
import { log } from "../log";

export function installSkillsToDir(skills: Skill[], dir: string, displayPrefix: string): void {
  for (const skill of skills) {
    const dest = join(dir, skill.name);
    mkdirSync(dest, { recursive: true });
    cpSync(skill.path, join(dest, "SKILL.md"));
    log.success(`Installed skill ${skill.name} → ${displayPrefix}/${skill.name}/SKILL.md`);
  }
}
