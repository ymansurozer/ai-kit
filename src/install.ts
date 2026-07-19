import { homedir } from "os";

import type { Skill, McpConfig } from "./config";
import { loadSkills, loadMcps } from "./config";
import { configPhase, finalizeMcpManagedHashes, type ConfigTargetOutcome } from "./config-install";
import { log } from "./log";
import { pruneMcps, pruneSkills } from "./prune";
import { findInstallation, saveInstallation } from "./state";
import { installClaude } from "./targets/claude";
import { installCodex } from "./targets/codex";
import { DESCRIPTORS, type TargetName } from "./targets/descriptors";
import { installOpencode } from "./targets/opencode";
import { installPi } from "./targets/pi";

type TargetInstaller = (skills: Skill[], mcps: McpConfig[], global: boolean, cwd: string) => void;

const TARGETS: Record<string, TargetInstaller> = {
  claude: installClaude,
  codex: installCodex,
  pi: installPi,
  opencode: installOpencode,
};

export interface InstallOptions {
  global: boolean;
  skills?: string[];
  mcps?: string[];
  cwd?: string;
  /** Overwrite drifted config destinations on a global install (PRD behavior 9). */
  force?: boolean;
  /**
   * Internal: set by the `target === "all"` fan-out once it has already warned
   * about not-found names, so each per-target call doesn't warn again.
   */
  suppressNotFoundWarnings?: boolean;
}

/**
 * Warn about requested skill/MCP names that don't exist in the repo exactly
 * once, before the `all` fan-out calls `install()` per target — otherwise each
 * target re-resolves the same cherry-picked selection and warns again, so one
 * typo would log 4x.
 */
function warnNotFoundOnce(options: InstallOptions): void {
  if (options.skills) {
    const skills = loadSkills();
    const found = new Set(skills.map((s) => s.name));
    for (const name of options.skills) {
      if (!found.has(name)) {
        log.warn(`Skill not found: ${name}`);
      }
    }
  }

  if (options.mcps) {
    const mcps = loadMcps();
    const found = new Set(mcps.map((m) => m.name));
    for (const name of options.mcps) {
      if (!found.has(name)) {
        log.warn(`MCP not found: ${name}`);
      }
    }
  }
}

export function install(target: string, options: InstallOptions): void {
  if (target === "all") {
    warnNotFoundOnce(options);
    for (const t of Object.keys(TARGETS)) {
      install(t, { ...options, suppressNotFoundWarnings: true });
    }
    return;
  }

  if (!TARGETS[target]) {
    throw new Error(`Unknown target: ${target}. Available: ${Object.keys(TARGETS).join(", ")}, all`);
  }

  const cwd = options.cwd || process.cwd();

  // Config phase (global only, PRD behaviors 1, 2, 3, 11): write this target's
  // config files BEFORE the target installer's MCP merge so MCP sections land on
  // top of the config file and the recorded hash covers the final content
  // (behavior 10). Falls out of the descriptor tree — Pi installs config even
  // though it gets no MCPs. Runs before the skills/MCPs early-return so a
  // config-only tree still installs.
  let configResult: ConfigTargetOutcome | undefined;
  if (options.global) {
    configResult = configPhase(target as TargetName, { home: homedir(), force: options.force });
  }

  let skills = loadSkills();
  let mcps = loadMcps();

  if (options.skills) {
    const requested = new Set(options.skills);
    const filtered = skills.filter((s) => requested.has(s.name));
    if (!options.suppressNotFoundWarnings) {
      const found = new Set(filtered.map((s) => s.name));
      for (const name of requested) {
        if (!found.has(name)) {
          log.warn(`Skill not found: ${name}`);
        }
      }
    }
    skills = filtered;
  }

  if (options.mcps) {
    const requested = new Set(options.mcps);
    const filtered = mcps.filter((m) => requested.has(m.name));
    if (!options.suppressNotFoundWarnings) {
      const found = new Set(filtered.map((m) => m.name));
      for (const name of requested) {
        if (!found.has(name)) {
          log.warn(`MCP not found: ${name}`);
        }
      }
    }
    mcps = filtered;
  }

  const t = target as TargetName;
  const supportsMcps = DESCRIPTORS[t].supportsMcps;
  const installedMcps = supportsMcps ? mcps : [];

  log.heading(`Installing to ${target}${options.global ? " (global)" : ""}`);

  const nothingToInstall = skills.length === 0 && installedMcps.length === 0;

  // Read the prior installation to know what was installed last run — the pruning
  // snapshot. A legacy entry (or none) has `undefined` snapshot fields → nothing to
  // prune, so the first run after upgrade only records, and removals propagate next.
  const installPath = options.global ? undefined : cwd;
  const prior = findInstallation(target, options.global, installPath);
  const priorSkills = prior?.installedSkills;
  const priorMcps = prior?.installedMcps;
  const hasPriorSnapshot = priorSkills !== undefined || priorMcps !== undefined;

  // A true no-op leaves state untouched: nothing to install, no prior snapshot to
  // prune against, and (for a global install) no config tree worth tracking. A prior
  // snapshot forces the run through — the user may have deleted their last skill, and
  // that removal must still propagate (prune) and be recorded (empty snapshot). A
  // global install that just wrote config files must also fall through so their
  // hashes get recorded, or that config reads back as unmanaged forever after.
  const isNoOp = nothingToInstall && !hasPriorSnapshot && (!options.global || !configResult?.hadFiles);

  // Pi user-error path: only MCPs requested for a target that can't install them.
  // Warn either way, but only bail on a true no-op. A prior snapshot (drop the last
  // skill) or config files written this run (global config tree) must still be
  // reconciled and recorded — fall through to prune + save even with nothing to install.
  if (nothingToInstall && !supportsMcps && mcps.length > 0) {
    log.warn("Pi does not support MCPs — nothing to install");
    if (isNoOp) {
      return;
    }
  } else if (isNoOp) {
    log.warn("Nothing to install");
    return;
  }

  if (!nothingToInstall) {
    TARGETS[target](skills, mcps, options.global, cwd);
  }

  // Prune orphans: names the snapshot recorded that this run did NOT install. Only
  // recorded names are ever deleted (ownership contract) — hand-placed skill dirs and
  // hand-added MCP servers are never in the snapshot, so they are never touched.
  const home = homedir();
  const thisRunSkillNames = skills.map((s) => s.name);
  const thisRunMcpNames = installedMcps.map((m) => m.name);
  const pruneSkillNames = (priorSkills ?? []).filter((n) => !thisRunSkillNames.includes(n));
  const pruneMcpNames = (priorMcps ?? []).filter((n) => !thisRunMcpNames.includes(n));
  pruneSkills(t, options.global, cwd, home, pruneSkillNames);
  pruneMcps(t, options.global, cwd, home, pruneMcpNames);

  // Re-hash mcp-managed destination files the config phase wrote, now that the MCP
  // merge AND the prune above have run, so the recorded hash covers the final
  // content (behavior 10) and a pruned MCP entry does not read back as self-drift.
  const configFiles = configResult ? finalizeMcpManagedHashes(t, configResult) : undefined;

  // Record the SELECTION, not the resolved snapshot: a full install (no --skills/
  // --mcps) records `undefined` so sync re-scans the repo each cycle and picks up
  // additions/removals; a cherry-picked install records its explicit list. Pi has
  // no MCP support, so its mcps selection is permanently empty, not "all".
  const recordedSkills = options.skills ? skills.map((s) => s.name) : undefined;
  const recordedMcps = options.mcps ? installedMcps.map((m) => m.name) : supportsMcps ? undefined : [];

  saveInstallation({
    target,
    global: options.global,
    path: installPath,
    skills: recordedSkills,
    mcps: recordedMcps,
    // The pruning snapshot: the exact names installed this run, replaced wholesale
    // so the next run's prune set is `this snapshot − that run's installed names`.
    installedSkills: thisRunSkillNames,
    installedMcps: thisRunMcpNames,
    // Mark every global install as config-bearing so config-only and full
    // installs look alike to sync (config sticks across saves in state).
    config: options.global || undefined,
    configFiles,
    installedAt: new Date().toISOString(),
  });

  log.info(`Installed ${skills.length} skill(s) and ${installedMcps.length} MCP(s)`);
}
