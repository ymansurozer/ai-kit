import type { Skill, McpConfig } from "./config";
import { loadSkills, loadMcps } from "./config";
import { saveInstallation } from "./state";
import { installClaude } from "./targets/claude";
import { installCodex } from "./targets/codex";
import { installPi } from "./targets/pi";
import { installOpencode } from "./targets/opencode";
import { log } from "./log";

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
  if (!TARGETS[target]) {
    throw new Error(
      `Unknown target: ${target}. Available: ${Object.keys(TARGETS).join(", ")}`,
    );
  }

  let skills = loadSkills();
  let mcps = loadMcps();

  if (options.skills) {
    const requested = new Set(options.skills);
    const filtered = skills.filter((s) => requested.has(s.name));
    const found = new Set(filtered.map((s) => s.name));
    for (const name of requested) {
      if (!found.has(name)) log.warn(`Skill not found: ${name}`);
    }
    skills = filtered;
  }

  if (options.mcps) {
    const requested = new Set(options.mcps);
    const filtered = mcps.filter((m) => requested.has(m.name));
    const found = new Set(filtered.map((m) => m.name));
    for (const name of requested) {
      if (!found.has(name)) log.warn(`MCP not found: ${name}`);
    }
    mcps = filtered;
  }

  const installedMcps = target === "pi" ? [] : mcps;

  const cwd = options.cwd || process.cwd();

  log.heading(`Installing to ${target}${options.global ? " (global)" : ""}`);

  if (skills.length === 0 && installedMcps.length === 0) {
    if (target === "pi" && mcps.length > 0) {
      log.warn("Pi does not support MCPs — nothing to install");
      return;
    }
    log.warn("Nothing to install");
    return;
  }

  TARGETS[target](skills, mcps, options.global, cwd);

  saveInstallation({
    target,
    global: options.global,
    path: options.global ? undefined : cwd,
    skills: skills.map((s) => s.name),
    mcps: installedMcps.map((m) => m.name),
    installedAt: new Date().toISOString(),
  });

  log.info(
    `Installed ${skills.length} skill(s) and ${installedMcps.length} MCP(s)`,
  );
}
