import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, MCPS_DIR } from "./config";
import { log } from "./log";

export function add(type: string, name: string): void {
  if (type === "skill") {
    addSkill(name);
  } else if (type === "mcp") {
    addMcp(name);
  } else {
    log.error(`Unknown type: ${type}. Use "skill" or "mcp".`);
    process.exit(1);
  }
}

function addSkill(name: string): void {
  const dir = join(SKILLS_DIR, name);
  const filePath = join(dir, "SKILL.md");

  if (existsSync(filePath)) {
    log.error(`Skill already exists: ${name}`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(
    filePath,
    `---
name: ${name}
description: TODO — describe what this skill does
---

# ${name}

## Steps
1. ...
`,
  );

  log.success(`Created skill: skills/${name}/SKILL.md`);
}

function addMcp(name: string): void {
  const filePath = join(MCPS_DIR, `${name}.json`);

  if (existsSync(filePath)) {
    log.error(`MCP already exists: ${name}`);
    process.exit(1);
  }

  mkdirSync(MCPS_DIR, { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        description: "TODO — describe this MCP server",
        config: {
          command: "npx",
          args: ["-y", "@example/mcp-server"],
        },
      },
      null,
      2,
    ) + "\n",
  );

  log.success(`Created MCP: mcps/${name}.json`);
}
