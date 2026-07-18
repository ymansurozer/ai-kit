import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

import { AI_KIT_ROOT } from "./config";
import { CONFIG_DIR } from "./config-tree";
import { log } from "./log";
import { configRootFor, DESCRIPTORS, type TargetName } from "./targets/descriptors";

const TARGET_NAMES = Object.keys(DESCRIPTORS) as TargetName[];

export interface ConfigCaptureOptions {
  home?: string;
  configDir?: string;
  /** Capture one specific path relative to the config root, even if not curated.
   * Requires an explicit single target. Directories capture recursively. */
  file?: string;
}

function resolveCaptureTargets(target: string | undefined): TargetName[] {
  if (!target || target === "all") {
    return TARGET_NAMES;
  }
  if (!TARGET_NAMES.includes(target as TargetName)) {
    throw new Error(`Unknown target: ${target}. Available: ${TARGET_NAMES.join(", ")}, all`);
  }
  return [target as TargetName];
}

/** Recursively collect file paths under `dir`, relative to `dir` (POSIX-joined). */
function collectRelPaths(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRelPaths(abs, relPath, out);
    } else if (entry.isFile()) {
      out.push(relPath);
    }
  }
}

function isBannedPath(target: TargetName, relPath: string): boolean {
  return DESCRIPTORS[target].bannedConfigPaths.some((b) => relPath === b || relPath.startsWith(`${b}/`));
}

/**
 * Normalize a `--file` value to a config-root-relative POSIX path, rejecting any
 * value that would escape the config root (`..`, absolute paths). Throws with the
 * offending value and the root so the caller need not add context.
 */
function normalizeFileArg(target: TargetName, configRoot: string, file: string): string {
  const abs = resolve(configRoot, file);
  const rel = relative(configRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `--file ${file} resolves outside ${target}'s config root (${configRoot}); ` +
        `capture only reaches paths under the config root.`,
    );
  }
  return rel.split(sep).join("/");
}

/**
 * Determine the set of config-root-relative paths to capture for one target.
 *
 * With `fileArg`: exactly that path (recursive when it's a directory), after
 * rejecting escapes and banned paths and confirming it exists on the machine.
 *
 * Without `fileArg`: the union of (a) files already tracked in the base tree
 * `config/<target>/` — read raw, so capture compares against the repo, not an
 * overlay-merged view — and (b) curated well-known files/dirs from the descriptor
 * that exist under the machine's config root. Banned paths are never captured
 * implicitly. Tracked paths absent on the machine are returned as `missing`, not
 * captured, and are left untouched in the repo.
 */
function patchToCapture(
  target: TargetName,
  configRoot: string,
  baseTargetDir: string,
  fileArg: string | undefined,
): { capture: string[]; missing: string[] } {
  if (fileArg !== undefined) {
    const rel = normalizeFileArg(target, configRoot, fileArg);
    if (isBannedPath(target, rel)) {
      throw new Error(
        `--file ${fileArg} points inside ${target}'s "${rel.split("/")[0]}/" — ai-kit's own ` +
          `skill-install output (runtime state), not shippable config. It is never captured.`,
      );
    }
    const abs = join(configRoot, rel);
    if (!existsSync(abs)) {
      throw new Error(`--file ${fileArg} not found on this machine at ${abs}`);
    }
    if (statSync(abs).isDirectory()) {
      const nested: string[] = [];
      collectRelPaths(abs, rel, nested);
      return { capture: nested, missing: [] };
    }
    return { capture: [rel], missing: [] };
  }

  const tracked: string[] = [];
  if (existsSync(baseTargetDir)) {
    collectRelPaths(baseTargetDir, "", tracked);
  }

  const curated: string[] = [];
  for (const entry of DESCRIPTORS[target].curatedFiles) {
    if (entry.endsWith("/")) {
      const dirRel = entry.slice(0, -1);
      const absDir = join(configRoot, dirRel);
      if (existsSync(absDir) && statSync(absDir).isDirectory()) {
        collectRelPaths(absDir, dirRel, curated);
      }
    } else {
      const abs = join(configRoot, entry);
      if (existsSync(abs) && statSync(abs).isFile()) {
        curated.push(entry);
      }
    }
  }

  const union = new Set<string>();
  for (const rel of [...tracked, ...curated]) {
    if (!isBannedPath(target, rel)) {
      union.add(rel);
    }
  }

  const capture: string[] = [];
  const missing: string[] = [];
  for (const rel of union) {
    if (existsSync(join(configRoot, rel))) {
      capture.push(rel);
    } else {
      missing.push(rel);
    }
  }
  return { capture, missing };
}

function captureTarget(target: TargetName, home: string, configDir: string, fileArg: string | undefined): void {
  const configRoot = configRootFor(target, home);
  const baseTargetDir = join(configDir, target);
  const { capture, missing } = patchToCapture(target, configRoot, baseTargetDir, fileArg);

  log.heading(`Capturing ${target} config`);

  for (const rel of capture.toSorted()) {
    const src = join(configRoot, rel);
    const dest = join(baseTargetDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    log.success(`Captured ${rel} ← ${src}`);
  }

  for (const rel of missing.toSorted()) {
    log.warn(`Missing on this machine: ${rel} — left the repo copy as-is`);
  }

  if (capture.length === 0 && missing.length === 0) {
    log.info(`Nothing to capture for ${target}`);
  }
}

/**
 * `ai-kit config capture [target] [--file <relpath>]` — copy live machine config
 * into the repo BASE tree (`config/<target>/`) for git-diff review (PRD behaviors
 * 16, 17, 18, 22). The day-one seeding path and the drift-reconciliation path.
 *
 * No target captures every target; a target limits to one; `--file` requires an
 * explicit single target. Capture only reads and copies raw bytes: it never
 * installs, never touches state hashes, never expands or contracts `${VAR}`, and
 * never writes overlay (`@`) directories — overlay attribution is slice 08.
 *
 * `home`/`configDir` are test seams, defaulting to the real home and repo `config/`.
 */
export function configCapture(target?: string, options: ConfigCaptureOptions = {}): void {
  const home = options.home ?? homedir();
  const configDir = options.configDir ?? join(AI_KIT_ROOT, CONFIG_DIR);
  const fileArg = options.file;

  if (fileArg !== undefined && (!target || target === "all")) {
    throw new Error("--file requires an explicit target: ai-kit config capture <target> --file <path>");
  }

  const targets = resolveCaptureTargets(target);
  for (const t of targets) {
    captureTarget(t, home, configDir, fileArg);
  }

  log.info("Review the captured files with git diff, then commit.");
}
