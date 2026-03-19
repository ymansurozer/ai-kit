import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { loadSkills, SKILLS_DIR } from "./config";
import { log } from "./log";

export async function update(name?: string): Promise<void> {
  const skills = loadSkills();
  let sourced;
  if (name) {
    const skill = skills.find((s) => s.name === name);
    if (!skill) {
      log.error(`Skill not found: ${name}`);
      process.exit(1);
    }
    if (!skill.source) {
      log.error(`Skill "${name}" has no source — nothing to update`);
      process.exit(1);
    }
    sourced = [skill];
  } else {
    sourced = skills.filter((s) => s.source);
  }

  if (sourced.length === 0) {
    log.warn("No sourced skills to update");
    return;
  }

  log.heading("Updating sourced skills");

  let updated = 0;
  for (const skill of sourced) {
    if (!skill.source) continue;

    log.info(`Fetching ${skill.name} from ${skill.source.url}`);

    const response = await fetch(skill.source.url);
    if (!response.ok) {
      log.error(
        `  Failed: ${response.status} ${response.statusText} — skipping`,
      );
      continue;
    }

    const content = await response.text();
    writeFileSync(skill.path, content);
    writeFileSync(
      join(SKILLS_DIR, skill.name, "source.json"),
      JSON.stringify(
        { url: skill.source.url, fetchedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );

    log.success(`Updated ${skill.name}`);
    updated++;
  }

  log.info(`Updated ${updated}/${sourced.length} sourced skill(s)`);
}
