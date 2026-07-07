import { homedir } from "os";
import { join } from "path";

import type { Skill, McpConfig } from "../config";
import { log } from "../log";
import { installSkillsToDir } from "./shared";

export function installPi(skills: Skill[], mcps: McpConfig[], global: boolean, cwd: string): void {
  const dir = global ? join(homedir(), ".agents", "skills") : join(cwd, ".agents", "skills");
  const displayPrefix = global ? "~/.agents/skills" : ".agents/skills";

  installSkillsToDir(skills, dir, displayPrefix);

  if (mcps.length > 0) {
    log.warn("Pi does not support MCPs — skipping MCP installation");
  }
}
