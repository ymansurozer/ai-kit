import { mkdirSync, cpSync, readdirSync } from "fs";
import { join, dirname } from "path";

import type { Skill } from "../config";
import { log } from "../log";

const SKILL_INTERNAL_FILES = new Set(["SKILL.md", "source.json"]);

export function copySkillAssets(skillPath: string, dest: string): void {
  const skillDir = dirname(skillPath);
  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    const src = join(skillDir, entry.name);
    if (src === skillPath) {
      continue;
    }
    if (SKILL_INTERNAL_FILES.has(entry.name)) {
      continue;
    }
    cpSync(src, join(dest, entry.name), { recursive: true });
  }
}

export function installSkillsToDir(skills: Skill[], dir: string, displayPrefix: string): void {
  for (const skill of skills) {
    const dest = join(dir, skill.name);
    mkdirSync(dest, { recursive: true });
    cpSync(skill.path, join(dest, "SKILL.md"));
    copySkillAssets(skill.path, dest);
    log.success(`Installed skill ${skill.name} → ${displayPrefix}/${skill.name}/SKILL.md`);
  }
}
