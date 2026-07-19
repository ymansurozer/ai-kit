import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { SKILLS_DIR } from "./config";
import { log } from "./log";

/**
 * Fetch a skill using Vercel's skills CLI (`bunx skills add`).
 * Runs in a temp directory, then copies the SKILL.md into our skills/ folder.
 */
export function fetchSkill(name: string, from: string): boolean {
  const tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-"));

  try {
    log.info(`Fetching ${name} from ${from}`);

    const result = spawnSync("bunx", ["skills", "add", from, "--skill", name, "--copy", "-y"], {
      cwd: tmpDir,
      stdio: "pipe",
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || "Unknown error";
      log.error(`skills CLI failed: ${stderr}`);
      return false;
    }

    const skillMd = findSkillMd(tmpDir, name);
    if (!skillMd) {
      log.error(`Could not find SKILL.md for "${name}" in fetched content`);
      return false;
    }

    const destDir = join(SKILLS_DIR, name);
    // The fresh fetch already succeeded (skillMd was found above) — safe to replace
    // the existing skill dir now so files upstream deleted/renamed don't linger.
    replaceSkillDir(dirname(skillMd), destDir);

    writeFileSync(
      join(destDir, "source.json"),
      JSON.stringify({ from, skill: name, fetchedAt: new Date().toISOString() }, null, 2) + "\n",
    );

    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Replace `destDir`'s contents with `srcDir`'s: clears any stale files (e.g. ones
 * upstream deleted or renamed since the last update) before copying the fresh
 * fetch in. Exported for direct testing since the caller only reaches this point
 * after a fetch has already succeeded — a failed fetch never touches `destDir`.
 */
export function replaceSkillDir(srcDir: string, destDir: string): void {
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  cpSync(srcDir, destDir, { recursive: true });
}

function findSkillMd(baseDir: string, name: string): string | null {
  // Check common agent skill locations
  const candidates = [
    join(baseDir, ".agents", "skills", name, "SKILL.md"),
    join(baseDir, ".claude", "skills", name, "SKILL.md"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Fallback: recursive search for any SKILL.md
  return findFile(baseDir, "SKILL.md");
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function findFile(dir: string, filename: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return full;
    }
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      const found = findFile(full, filename);
      if (found) {
        return found;
      }
    }
  }
  return null;
}
