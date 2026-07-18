import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import { AI_KIT_ROOT } from "./config";
import { CONFIG_DIR, loadConfigTreeFrom, type ConfigFile } from "./config-tree";
import { log } from "./log";
import { saveInstallationTo, STATE_PATH } from "./state";
import { configRootFor, DESCRIPTORS, type TargetName } from "./targets/descriptors";

export interface InstallConfigOutcome {
  installed: string[];
  skippedExisting: string[];
}

const TARGET_NAMES = Object.keys(DESCRIPTORS) as TargetName[];

/**
 * Write a config file set under `rootDir`, creating parent directories. Blanket
 * safety for this slice: an existing destination is skipped, never overwritten
 * (slice 03 replaces this with hash-based drift detection). Returns per-file
 * outcomes.
 */
export function installConfigFiles(files: ConfigFile[], rootDir: string): InstallConfigOutcome {
  const installed: string[] = [];
  const skippedExisting: string[] = [];

  for (const file of files) {
    const dest = join(rootDir, file.relPath);
    if (existsSync(dest)) {
      skippedExisting.push(file.relPath);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
    installed.push(file.relPath);
  }

  return { installed, skippedExisting };
}

export interface ConfigInstallOptions {
  home?: string;
  configDir?: string;
  statePath?: string;
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
  const tree = loadConfigTreeFrom(configDir);

  let wroteAnything = false;

  for (const t of targets) {
    const files = tree[t];
    if (files.length === 0) {
      continue;
    }

    wroteAnything = true;
    const rootDir = configRootFor(t, home);
    log.heading(`Installing config to ${t} (global)`);
    const outcome = installConfigFiles(files, rootDir);

    for (const relPath of outcome.installed) {
      log.success(`Installed config ${relPath} → ${rootDir}/${relPath}`);
    }
    for (const relPath of outcome.skippedExisting) {
      log.warn(`Skipped existing ${relPath} → ${rootDir}/${relPath}`);
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
      installedAt: new Date().toISOString(),
    });
  }

  if (!wroteAnything) {
    const scope = target && target !== "all" ? ` for ${target}` : "";
    log.info(`No config files to install${scope} — config tree is empty`);
  }
}
