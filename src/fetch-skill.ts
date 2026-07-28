import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";

import { SKILLS_DIR } from "./config";
import { log } from "./log";

/**
 * Resolves the local destination name and the upstream skill identifier used
 * to fetch it. Defaults `upstreamSkill` to `localName` so callers that don't
 * distinguish the two see identical behavior.
 */
export function resolveFetchNames(
  localName: string,
  upstreamSkill?: string,
): { localName: string; upstreamSkill: string } {
  return { localName, upstreamSkill: upstreamSkill ?? localName };
}

/**
 * Fetch a skill using Vercel's skills CLI (`bunx skills add`).
 * Runs in a temp directory, then copies the SKILL.md into our skills/ folder.
 */
export function fetchSkill(localName: string, from: string, upstreamSkill?: string): boolean {
  const names = resolveFetchNames(localName, upstreamSkill);
  const tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-"));

  try {
    log.info(`Fetching ${names.localName} from ${from}`);

    const result = spawnSync("bunx", ["skills", "add", from, "--skill", names.upstreamSkill, "--copy", "-y"], {
      cwd: tmpDir,
      stdio: "pipe",
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || "Unknown error";
      log.error(`skills CLI failed: ${stderr}`);
      return false;
    }

    const skillMd = findSkillMd(tmpDir, names.upstreamSkill);
    if (!skillMd) {
      log.error(`Could not find SKILL.md for "${names.upstreamSkill}" in fetched content`);
      return false;
    }

    const destDir = join(SKILLS_DIR, names.localName);
    // The fresh fetch already succeeded (skillMd was found above) — safe to replace
    // the existing skill dir now so files upstream deleted/renamed don't linger.
    replaceSkillDir(dirname(skillMd), destDir);

    // Rewrite the frontmatter `name:` to the local name so the folder name and the
    // name loadSkillsFrom reads can never diverge (loadSkillsFrom prefers frontmatter).
    const destSkillMd = join(destDir, "SKILL.md");
    writeFileSync(destSkillMd, rewriteFrontmatterName(readFileSync(destSkillMd, "utf-8"), names.localName));

    writeFileSync(
      join(destDir, "source.json"),
      JSON.stringify({ from, skill: names.upstreamSkill, fetchedAt: new Date().toISOString() }, null, 2) + "\n",
    );

    return true;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Rewrite the `name:` field in a SKILL.md's leading frontmatter block to `name`.
 * Operates only on the leading `---\n...\n---` block (the format `parseFrontmatter`
 * assumes); the body — including any `name:` occurrence after the closing `---` —
 * is left byte-for-byte untouched. If the block has no `name:` line, one is inserted
 * first; if there's no frontmatter block at all, the content is returned unchanged
 * (loadSkillsFrom then falls back to the folder name, which is already the local name).
 */
export function rewriteFrontmatterName(content: string, name: string): string {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return content;
  }

  const lines = match[1].split("\n");
  const nameIdx = lines.findIndex((line) => {
    const idx = line.indexOf(":");
    return idx !== -1 && line.slice(0, idx).trim() === "name";
  });
  if (nameIdx === -1) {
    lines.unshift(`name: ${name}`);
  } else {
    lines[nameIdx] = `name: ${name}`;
  }

  return `---\n${lines.join("\n")}\n---` + content.slice(match[0].length);
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
