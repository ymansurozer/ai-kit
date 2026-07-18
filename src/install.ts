import { homedir } from "os";

import type { Skill, McpConfig } from "./config";
import { loadSkills, loadMcps } from "./config";
import { configPhase, finalizeMcpManagedHashes, type ConfigTargetOutcome } from "./config-install";
import { log } from "./log";
import { saveInstallation } from "./state";
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
}

export function install(target: string, options: InstallOptions): void {
  if (target === "all") {
    for (const t of Object.keys(TARGETS)) {
      install(t, options);
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
    const found = new Set(filtered.map((s) => s.name));
    for (const name of requested) {
      if (!found.has(name)) {
        log.warn(`Skill not found: ${name}`);
      }
    }
    skills = filtered;
  }

  if (options.mcps) {
    const requested = new Set(options.mcps);
    const filtered = mcps.filter((m) => requested.has(m.name));
    const found = new Set(filtered.map((m) => m.name));
    for (const name of requested) {
      if (!found.has(name)) {
        log.warn(`MCP not found: ${name}`);
      }
    }
    mcps = filtered;
  }

  const supportsMcps = DESCRIPTORS[target as TargetName].supportsMcps;
  const installedMcps = supportsMcps ? mcps : [];

  log.heading(`Installing to ${target}${options.global ? " (global)" : ""}`);

  const nothingToInstall = skills.length === 0 && installedMcps.length === 0;

  if (nothingToInstall) {
    if (!supportsMcps && mcps.length > 0) {
      log.warn("Pi does not support MCPs — nothing to install");
      return;
    }
    // A global install with a non-empty config tree is still worth tracking: its
    // config phase ran and sync must keep re-scanning the tree. Only a per-repo
    // install, or a global install with nothing to write at all, is a true no-op.
    if (!options.global || !configResult?.hadFiles) {
      log.warn("Nothing to install");
      return;
    }
  } else {
    TARGETS[target](skills, mcps, options.global, cwd);
  }

  // Re-hash mcp-managed destination files the config phase wrote, now that the MCP
  // merge has run, so the recorded hash covers the final merged content (behavior 10).
  const configFiles = configResult ? finalizeMcpManagedHashes(target as TargetName, configResult) : undefined;

  // Record the SELECTION, not the resolved snapshot: a full install (no --skills/
  // --mcps) records `undefined` so sync re-scans the repo each cycle and picks up
  // additions/removals; a cherry-picked install records its explicit list. Pi has
  // no MCP support, so its mcps selection is permanently empty, not "all".
  const recordedSkills = options.skills ? skills.map((s) => s.name) : undefined;
  const recordedMcps = options.mcps ? installedMcps.map((m) => m.name) : supportsMcps ? undefined : [];

  saveInstallation({
    target,
    global: options.global,
    path: options.global ? undefined : cwd,
    skills: recordedSkills,
    mcps: recordedMcps,
    // Mark every global install as config-bearing so config-only and full
    // installs look alike to sync (config sticks across saves in state).
    config: options.global || undefined,
    configFiles,
    installedAt: new Date().toISOString(),
  });

  log.info(`Installed ${skills.length} skill(s) and ${installedMcps.length} MCP(s)`);
}
