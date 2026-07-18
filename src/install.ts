import type { Skill, McpConfig } from "./config";
import { loadSkills, loadMcps } from "./config";
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

  const cwd = options.cwd || process.cwd();

  log.heading(`Installing to ${target}${options.global ? " (global)" : ""}`);

  if (skills.length === 0 && installedMcps.length === 0) {
    if (!supportsMcps && mcps.length > 0) {
      log.warn("Pi does not support MCPs — nothing to install");
      return;
    }
    log.warn("Nothing to install");
    return;
  }

  TARGETS[target](skills, mcps, options.global, cwd);

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
    installedAt: new Date().toISOString(),
  });

  log.info(`Installed ${skills.length} skill(s) and ${installedMcps.length} MCP(s)`);
}
