import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, MCPS_DIR } from "./config";
import { fetchSkill } from "./fetch-skill";
import { log } from "./log";

export interface AddOptions {
  from?: string;
}

export function add(type: string, name: string, options: AddOptions = {}): void {
  if (type === "skill") {
    addSkill(name, options);
  } else if (type === "mcp") {
    addMcp(name);
  } else {
    log.error(`Unknown type: ${type}. Use "skill" or "mcp".`);
    process.exit(1);
  }
}

function addSkill(name: string, options: AddOptions): void {
  const dir = join(SKILLS_DIR, name);
  const filePath = join(dir, "SKILL.md");

  if (existsSync(filePath)) {
    log.error(`Skill already exists: ${name}`);
    process.exit(1);
  }

  if (options.from) {
    const ok = fetchSkill(name, options.from);
    if (!ok) process.exit(1);
    log.success(`Fetched skill: skills/${name}/SKILL.md`);
    log.dim(`  Source: ${options.from}`);
  } else {
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
