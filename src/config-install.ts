import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import { loadMcps, type McpConfig } from "./config";
import { defaultConfigDir, expandEnvVars, loadConfigTreeFrom, type ConfigFile } from "./config-tree";
import { log } from "./log";
import { resolveMachineFrom } from "./machine";
import { findInstallationFrom, saveInstallationTo, STATE_PATH } from "./state";
import { mergeCodexMcpsGlobal } from "./targets/codex";
import { configRootFor, DESCRIPTORS, type TargetName } from "./targets/descriptors";
import { mergeOpencodeMcpsGlobal } from "./targets/opencode";

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

function sha256(content: string | Buffer): string {
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
      // Hash raw bytes so binary destinations compare correctly; for valid UTF-8
      // text this digests the same bytes the string form did.
      if (sha256(readFileSync(dest)) !== recorded) {
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
  /** Environment used to expand `${VAR}` placeholders in file content (PRD
   * behavior 6). Defaults to `process.env`; a test seam. */
  env?: Record<string, string | undefined>;
  /** Machine name for overlay resolution (PRD behavior 5). Defaults to the state
   * override, else the normalized hostname; a test seam so tests never touch the
   * real hostname. */
  machine?: string;
  /** MCP list re-merged into mcp-managed destination files after the config phase
   * rewrites them (PRD behavior 10). Defaults to `loadMcps()`; a test seam so tests
   * never read the real repo `mcps/` tree. */
  mcps?: McpConfig[];
}

/** The result of writing one target's config file set, before state is recorded.
 * Carries enough for the caller to re-hash mcp-managed files after an MCP merge. */
export interface ConfigTargetOutcome {
  installed: string[];
  skippedDrift: { relPath: string; reason: DriftReason }[];
  skippedMissingVar: { relPath: string; missing: string[] }[];
  /** sha256 of the content written this run, keyed by relPath. */
  hashes: Record<string, string>;
  /** Absolute config-root directory the files were written under. */
  rootDir: string;
  /** Whether the config tree held any files for this target this run. */
  hadFiles: boolean;
}

/** Global config state is keyed under `path: undefined` — the same key the main
 * `install --global` uses — so a full install and a config-only install share one
 * entry and sync treats them alike. */
const GLOBAL_PATH = undefined;

/** Re-merge entry points for the targets whose MCP installer shares a destination
 * file with the config tree (codex: config.toml, opencode: opencode.json). */
const MCP_MANAGED_MERGERS: Partial<Record<TargetName, (mcps: McpConfig[], home: string) => void>> = {
  codex: mergeCodexMcpsGlobal,
  opencode: mergeOpencodeMcpsGlobal,
};

function resolveTargets(target: string | undefined): TargetName[] {
  if (!target || target === "all") {
    return TARGET_NAMES;
  }
  if (!TARGET_NAMES.includes(target as TargetName)) {
    throw new Error(`Unknown target: ${target}. Available: ${TARGET_NAMES.join(", ")}, all`);
  }
  return [target as TargetName];
}

function resolveMcpSelection(all: McpConfig[], selection: string[] | undefined): McpConfig[] {
  if (selection === undefined) {
    return all;
  }
  const set = new Set(selection);
  return all.filter((m) => set.has(m.name));
}

/**
 * Expand `${VAR}`, drift-check, and write one target's config file set under its
 * config root. State-free: logs each outcome and returns them; the caller records
 * state. Shared by the standalone `config install` and the global install phase.
 *
 * `${VAR}` is expanded before the drift check so the hash covers the final
 * per-machine content (PRD behavior 6). A file with any unset variable is skipped
 * and reported; siblings still install, and this is not a failure.
 */
function writeConfigForTarget(
  target: TargetName,
  files: ConfigFile[],
  opts: {
    home: string;
    recordedHashes: Record<string, string>;
    force: boolean;
    env: Record<string, string | undefined>;
  },
): ConfigTargetOutcome {
  const rootDir = configRootFor(target, opts.home);

  const expandedFiles: ConfigFile[] = [];
  const skippedMissingVar: { relPath: string; missing: string[] }[] = [];
  for (const file of files) {
    if (typeof file.content !== "string") {
      expandedFiles.push(file);
      continue;
    }
    const { content, missing } = expandEnvVars(file.content, opts.env);
    if (missing.length > 0) {
      skippedMissingVar.push({ relPath: file.relPath, missing });
      continue;
    }
    expandedFiles.push({ ...file, content });
  }

  const outcome = installConfigFiles(expandedFiles, rootDir, {
    recordedHashes: opts.recordedHashes,
    force: opts.force,
  });

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
  for (const skip of skippedMissingVar) {
    log.warn(
      `Skipped config ${skip.relPath} → ${rootDir}/${skip.relPath}: unset environment ` +
        `variable(s) ${skip.missing.join(", ")} — set them and re-run`,
    );
  }

  return {
    installed: outcome.installed,
    skippedDrift: outcome.skippedDrift,
    skippedMissingVar,
    hashes: outcome.hashes,
    rootDir,
    hadFiles: files.length > 0,
  };
}

export interface ConfigPhaseOptions {
  /** The home directory files are written under. Required — the global `install`
   * flow uses the real home so config lands next to the target installer's MCP
   * merge; tests inject a temp home. */
  home: string;
  configDir?: string;
  statePath?: string;
  force?: boolean;
  env?: Record<string, string | undefined>;
  machine?: string;
}

/**
 * Run the config phase for one target inside a global `install` (PRD behaviors 1,
 * 10): load the tree, write this target's config files under `home`, and return
 * the outcome. Deliberately does NOT record state — the caller folds the config
 * hashes into its single state entry AFTER the MCP merge (via
 * {@link finalizeMcpManagedHashes}), so the recorded hash covers the final
 * post-merge content and the next sync sees no self-drift. Recorded hashes come
 * from the global (`path: undefined`) entry, the key `install` writes.
 */
export function configPhase(target: TargetName, options: ConfigPhaseOptions): ConfigTargetOutcome {
  const configDir = options.configDir ?? defaultConfigDir();
  const statePath = options.statePath ?? STATE_PATH;
  const env = options.env ?? process.env;
  const machine = options.machine ?? resolveMachineFrom(statePath).name;
  const tree = loadConfigTreeFrom(configDir, machine);
  const files = tree[target];
  const rootDir = configRootFor(target, options.home);

  if (files.length === 0) {
    return { installed: [], skippedDrift: [], skippedMissingVar: [], hashes: {}, rootDir, hadFiles: false };
  }

  log.heading(`Installing config to ${target} (global)`);
  const recordedHashes = findInstallationFrom(statePath, target, true, GLOBAL_PATH)?.configFiles ?? {};
  return writeConfigForTarget(target, files, {
    home: options.home,
    recordedHashes,
    force: options.force ?? false,
    env,
  });
}

/**
 * After a target installer's MCP merge, re-hash the mcp-managed destination files
 * the config phase wrote this run so the recorded hash covers the final merged
 * content (PRD behavior 10) — otherwise the next sync sees ai-kit's own MCP merge
 * as drift. Returns the config-phase hash map with those entries updated from disk.
 */
export function finalizeMcpManagedHashes(target: TargetName, outcome: ConfigTargetOutcome): Record<string, string> {
  const hashes = { ...outcome.hashes };
  for (const relPath of DESCRIPTORS[target].mcpManagedFiles) {
    if (!outcome.installed.includes(relPath)) {
      continue;
    }
    const dest = join(outcome.rootDir, relPath);
    if (existsSync(dest)) {
      hashes[relPath] = sha256(readFileSync(dest, "utf-8"));
    }
  }
  return hashes;
}

/**
 * Install config files for one or all targets from the repo config tree
 * (`ai-kit config install`). Global by definition; records the installation in
 * state under `path: undefined`. `home`/`configDir` are test seams, defaulting to
 * the real home directory and repo `config/`.
 *
 * Standalone wrinkle (PRD behavior 10): writing the repo `config.toml` /
 * `opencode.json` over a destination that already held ai-kit's merged MCP sections
 * would drop them. So after writing an mcp-managed file, this re-runs that target's
 * global MCP merge with the machine's recorded selection and re-hashes the final
 * content, keeping both the repo config and the MCP sections coherent.
 */
export function configInstall(target?: string, options: ConfigInstallOptions = {}): void {
  const targets = resolveTargets(target);
  const home = options.home ?? homedir();
  const configDir = options.configDir ?? defaultConfigDir();
  const statePath = options.statePath ?? STATE_PATH;
  const force = options.force ?? false;
  const env = options.env ?? process.env;
  const machine = options.machine ?? resolveMachineFrom(statePath).name;
  const tree = loadConfigTreeFrom(configDir, machine);

  // Loaded lazily: only targets with a written mcp-managed file need the MCP list,
  // so a config-only tree never reads the repo `mcps/` directory.
  let cachedMcps: McpConfig[] | undefined;
  const allMcps = () => (cachedMcps ??= options.mcps ?? loadMcps());

  let wroteAnything = false;

  for (const t of targets) {
    const files = tree[t];
    if (files.length === 0) {
      continue;
    }
    wroteAnything = true;

    const existing = findInstallationFrom(statePath, t, true, GLOBAL_PATH);
    const recordedHashes = existing?.configFiles ?? {};
    log.heading(`Installing config to ${t} (global)`);
    const outcome = writeConfigForTarget(t, files, { home, recordedHashes, force, env });

    // Restore the MCP sections the config write dropped from mcp-managed dest files,
    // then re-hash so the recorded content matches the final merged file (behavior 10).
    // Only a target that already has an installation record can have had ai-kit MCP
    // sections written — its recorded selection (undefined = all, a list = that
    // subset, [] = none) says which to restore. A target with no record never had
    // MCPs installed, so there is nothing to restore and re-merging would inject
    // MCPs a config-only machine never asked for (see Deviations).
    const finalHashes = { ...outcome.hashes };
    const merger = MCP_MANAGED_MERGERS[t];
    if (merger && existing) {
      for (const relPath of DESCRIPTORS[t].mcpManagedFiles) {
        if (!outcome.installed.includes(relPath)) {
          continue;
        }
        const mcps = resolveMcpSelection(allMcps(), existing.mcps);
        if (mcps.length === 0) {
          continue;
        }
        merger(mcps, home);
        finalHashes[relPath] = sha256(readFileSync(join(outcome.rootDir, relPath), "utf-8"));
      }
    }

    saveInstallationTo(statePath, {
      target: t,
      global: true,
      path: GLOBAL_PATH,
      config: true,
      // Fresh entries record explicit empty selections: config-only installs must
      // NOT cause sync to later install all skills/MCPs (undefined means "all").
      // An existing entry keeps its own skills/mcps — mergeSelection ignores these.
      skills: [],
      mcps: [],
      // Hashes for files written this run; mergeConfigFiles keeps untouched
      // destinations' previously recorded hashes.
      configFiles: finalHashes,
      installedAt: new Date().toISOString(),
    });
  }

  if (!wroteAnything) {
    const scope = target && target !== "all" ? ` for ${target}` : "";
    log.info(`No config files to install${scope} — config tree is empty`);
  }
}
