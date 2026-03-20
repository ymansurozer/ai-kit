import { join } from "path";
import { homedir } from "os";
import type { Skill, McpConfig } from "../config";
import { installSkillsToDir } from "./shared";
import { log } from "../log";

export function installPi(
  skills: Skill[],
  mcps: McpConfig[],
  global: boolean,
  cwd: string,
): void {
  if (global) {
    installSkillsToDir(skills, join(homedir(), ".pi", "agent", "skills"), "~/.pi/agent/skills");
  } else {
    installSkillsToDir(skills, join(cwd, ".agents", "skills"), ".agents/skills");
  }

  if (mcps.length > 0) {
    log.warn("Pi does not support MCPs — skipping MCP installation");
  }
}
