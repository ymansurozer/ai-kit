import { join } from "path";

import { AI_KIT_ROOT, loadSkills, loadMcps } from "./config";
import { CONFIG_DIR, summarizeConfigTreeFrom, type ConfigTreeSummary } from "./config-tree";
import { log } from "./log";
import { resolveMachineFrom } from "./machine";
import { STATE_PATH } from "./state";
import { DESCRIPTORS, type TargetName } from "./targets/descriptors";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export interface ListOptions {
  /** Config tree to summarize. Test seam; defaults to the repo `config/`. */
  configDir?: string;
  /** State file the effective machine resolves from. Test seam. */
  statePath?: string;
  /** Effective machine name for overlay applicability. Test seam; defaults to the
   * resolved machine (override or normalized hostname). */
  machine?: string;
}

function renderConfigSection(summary: ConfigTreeSummary): void {
  log.heading("Config");

  const targets = Object.keys(DESCRIPTORS) as TargetName[];
  const withFiles = targets.filter((t) => summary.base[t].length > 0);

  if (withFiles.length === 0 && summary.overlays.length === 0) {
    log.dim("  No config files found. Run `ai-kit config capture` to seed the repo tree.");
    return;
  }

  for (const target of withFiles) {
    console.log(`  ${target}`);
    for (const rel of summary.base[target]) {
      console.log(`    ${rel}`);
    }
  }

  if (summary.overlays.length > 0) {
    console.log(`\n  ${DIM}Overlays (this machine: ${summary.machine})${RESET}`);
    for (const overlay of summary.overlays) {
      const applies = overlay.applies ? `  ${DIM}(applies)${RESET}` : "";
      const scope = overlay.targets.length > 0 ? `  ${DIM}— ${overlay.targets.join(", ")}${RESET}` : "";
      console.log(`  @${overlay.machine}${applies}${scope}`);
    }
  }
}

export function list(options: ListOptions = {}): void {
  const skills = loadSkills();
  const mcps = loadMcps();

  log.heading("Skills");
  if (skills.length === 0) {
    log.dim("  No skills found. Run `ai-kit skill add <name>` to create one.");
  } else {
    for (const skill of skills) {
      const sourced = skill.source ? "  \x1b[2m(third-party)\x1b[0m" : "";
      console.log(`  ${skill.name}${skill.description ? `  — ${skill.description}` : ""}${sourced}`);
    }
  }

  log.heading("MCPs");
  if (mcps.length === 0) {
    log.dim("  No MCPs found. Run `ai-kit mcp add <name>` to create one.");
  } else {
    for (const mcp of mcps) {
      const local = mcp.isLocal ? "  \x1b[2m(local)\x1b[0m" : "";
      console.log(`  ${mcp.name}${mcp.description ? `  — ${mcp.description}` : ""}${local}`);
    }
  }

  const configDir = options.configDir ?? join(AI_KIT_ROOT, CONFIG_DIR);
  const statePath = options.statePath ?? STATE_PATH;
  const machine = options.machine ?? resolveMachineFrom(statePath).name;
  renderConfigSection(summarizeConfigTreeFrom(configDir, machine));

  console.log();
}
