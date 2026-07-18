import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import { AI_KIT_ROOT } from "./config";
import { CONFIG_DIR, loadConfigTreeFrom, type ConfigFile } from "./config-tree";
import { log } from "./log";
import { findInstallationFrom, saveInstallationTo, STATE_PATH } from "./state";
import { configRootFor, DESCRIPTORS, type TargetName } from "./targets/descriptors";

/** Reason a config destination was skipped: it drifted from the last ai-kit write,
 * or it exists but ai-kit has never managed it (adoption case, PRD behavior 8). */
export type DriftReason = "drifted" | "unmanaged";

export interface InstallConfigOutcome {
  installed: string[];
  skippedDrift: { relPath: string; reason: DriftReason }[];
  /** sha256 of the content written this run, keyed by relPath — entries for
   * written files only, so callers can merge them over previously recorded hashes. */
  hashes: Record<string, string>;
}

export interface InstallConfigFilesOptions {
  /** Hashes ai-kit last recorded for these destinations (state.configFiles). */
  recordedHashes?: Record<string, string>;
  /** Overwrite drifted/unmanaged destinations regardless (PRD behavior 9). */
  force?: boolean;
}

const TARGET_NAMES = Object.keys(DESCRIPTORS) as TargetName[];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Write a config file set under `rootDir`, creating parent directories, with
 * drift-aware overwrite (PRD behaviors 7, 8, 9):
 *
 * - Destination missing → write.
 * - Destination present and its content matches the recorded hash → overwrite
 *   freely (the repo version wins silently).
 * - Destination present and its content differs from the recorded hash → skip
 *   (drifted). No recorded hash for an existing destination → skip (unmanaged,
 *   the adoption case).
 * - `force` → write regardless.
 *
 * Every write records the sha256 of the exact content written, so consecutive
 * installs with no external change report zero drift (idempotent).
 */
export function installConfigFiles(
  files: ConfigFile[],
  rootDir: string,
  options: InstallConfigFilesOptions = {},
): InstallConfigOutcome {
  const recordedHashes = options.recordedHashes ?? {};
  const force = options.force ?? false;
  const installed: string[] = [];
  const skippedDrift: { relPath: string; reason: DriftReason }[] = [];
  const hashes: Record<string, string> = {};

  for (const file of files) {
    const dest = join(rootDir, file.relPath);

    if (!force && existsSync(dest)) {
      const recorded = recordedHashes[file.relPath];
      if (recorded === undefined) {
        skippedDrift.push({ relPath: file.relPath, reason: "unmanaged" });
        continue;
      }
      if (sha256(readFileSync(dest, "utf-8")) !== recorded) {
        skippedDrift.push({ relPath: file.relPath, reason: "drifted" });
        continue;
      }
    }

    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
    installed.push(file.relPath);
    hashes[file.relPath] = sha256(file.content);
  }

  return { installed, skippedDrift, hashes };
}

export interface ConfigInstallOptions {
  home?: string;
  configDir?: string;
  statePath?: string;
  /** Override drift skips and let the repo version win (PRD behavior 9). */
  force?: boolean;
}

function resolveTargets(target: string | undefined): TargetName[] {
  if (!target || target === "all") {
    return TARGET_NAMES;
  }
  if (!TARGET_NAMES.includes(target as TargetName)) {
    throw new Error(`Unknown target: ${target}. Available: ${TARGET_NAMES.join(", ")}, all`);
  }
  return [target as TargetName];
}

/**
 * Install config files for one or all targets from the repo config tree.
 * Global by definition; records the installation in state. `home`/`configDir`
 * are test seams, defaulting to the real home directory and repo `config/`.
 */
export function configInstall(target?: string, options: ConfigInstallOptions = {}): void {
  const targets = resolveTargets(target);
  const home = options.home ?? homedir();
  const configDir = options.configDir ?? join(AI_KIT_ROOT, CONFIG_DIR);
  const statePath = options.statePath ?? STATE_PATH;
  const force = options.force ?? false;
  const tree = loadConfigTreeFrom(configDir);

  let wroteAnything = false;

  for (const t of targets) {
    const files = tree[t];
    if (files.length === 0) {
      continue;
    }

    wroteAnything = true;
    const rootDir = configRootFor(t, home);
    const recordedHashes = findInstallationFrom(statePath, t, true, home)?.configFiles ?? {};
    log.heading(`Installing config to ${t} (global)`);
    const outcome = installConfigFiles(files, rootDir, { recordedHashes, force });

    for (const relPath of outcome.installed) {
      log.success(`Installed config ${relPath} → ${rootDir}/${relPath}`);
    }
    for (const skip of outcome.skippedDrift) {
      const hint =
        skip.reason === "drifted"
          ? "modified since last install — capture it, or re-run with --force"
          : "exists but is not managed by ai-kit — capture it, or re-run with --force";
      log.warn(`Skipped config ${skip.relPath} → ${rootDir}/${skip.relPath}: ${hint}`);
    }

    saveInstallationTo(statePath, {
      target: t,
      global: true,
      path: home,
      config: true,
      // Fresh entries record explicit empty selections: config-only installs must
      // NOT cause sync to later install all skills/MCPs (undefined means "all").
      // An existing entry keeps its own skills/mcps — mergeSelection ignores these.
      skills: [],
      mcps: [],
      // Hashes for files written this run; mergeConfigFiles keeps untouched
      // destinations' previously recorded hashes.
      configFiles: outcome.hashes,
      installedAt: new Date().toISOString(),
    });
  }

  if (!wroteAnything) {
    const scope = target && target !== "all" ? ` for ${target}` : "";
    log.info(`No config files to install${scope} — config tree is empty`);
  }
}
