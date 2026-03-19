import { loadSkills } from "./config";
import { fetchSkill } from "./fetch-skill";
import { log } from "./log";

export function update(name?: string): void {
  const skills = loadSkills();

  let sourced;
  if (name) {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      log.error(`Skill not found: ${name}`);
      process.exit(1);
    }
    if (!skill.source) {
      log.error(`Skill "${name}" is not a third-party skill — nothing to update`);
      process.exit(1);
    }
    sourced = [skill];
  } else {
    sourced = skills.filter((s) => s.source);
  }

  if (sourced.length === 0) {
    log.warn("No third-party skills to update");
    return;
  }

  log.heading("Updating third-party skills");

  let updated = 0;
  for (const skill of sourced) {
    if (!skill.source) continue;

    const ok = fetchSkill(skill.name, skill.source.from);
    if (ok) {
      log.success(`Updated ${skill.name}`);
      updated++;
    } else {
      log.error(`  Failed to update ${skill.name} — skipping`);
    }
  }

  log.info(`Updated ${updated}/${sourced.length} third-party skill(s)`);
}
