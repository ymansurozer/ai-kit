import { loadSkills, loadMcps } from "./config";
import { log } from "./log";

export function list(): void {
  const skills = loadSkills();
  const mcps = loadMcps();

  log.heading("Skills");
  if (skills.length === 0) {
    log.dim("  No skills found. Run `ai-kit add skill <name>` to create one.");
  } else {
    for (const skill of skills) {
      const sourced = skill.source ? "  \x1b[2m(sourced)\x1b[0m" : "";
      console.log(
        `  ${skill.name}${skill.description ? `  — ${skill.description}` : ""}${sourced}`,
      );
    }
  }

  log.heading("MCPs");
  if (mcps.length === 0) {
    log.dim("  No MCPs found. Run `ai-kit add mcp <name>` to create one.");
  } else {
    for (const mcp of mcps) {
      const local = mcp.isLocal ? "  \x1b[2m(local)\x1b[0m" : "";
      console.log(
        `  ${mcp.name}${mcp.description ? `  — ${mcp.description}` : ""}${local}`,
      );
    }
  }

  console.log();
}
