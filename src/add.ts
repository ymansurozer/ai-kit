import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, MCPS_DIR, SERVERS_DIR } from "./config";
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
  } else if (type === "server") {
    addServer(name);
  } else {
    throw new Error(`Unknown type: ${type}. Use "skill", "mcp", or "server".`);
  }
}

function addSkill(name: string, options: AddOptions): void {
  const dir = join(SKILLS_DIR, name);
  const filePath = join(dir, "SKILL.md");

  if (existsSync(filePath)) {
    throw new Error(`Skill already exists: ${name}`);
  }

  if (options.from) {
    const ok = fetchSkill(name, options.from);
    if (!ok) throw new Error(`Failed to fetch skill "${name}" from ${options.from}`);
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
    throw new Error(`MCP already exists: ${name}`);
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

function addServer(name: string): void {
  const dir = join(SERVERS_DIR, name);

  if (existsSync(dir)) {
    throw new Error(`Server already exists: ${name}`);
  }

  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, "index.ts"),
    `import { FastMCP } from "fastmcp";
import { z } from "zod";

const server = new FastMCP("${name}");

server.addTool({
  name: "hello",
  description: "A sample tool — replace with your own",
  parameters: z.object({
    message: z.string().describe("A message to echo back"),
  }),
  execute: async ({ message }) => {
    return \`Hello: \${message}\`;
  },
});

server.start({ transportType: "stdio" });
`,
  );

  writeFileSync(
    join(dir, "server.json"),
    JSON.stringify(
      { description: "TODO — describe this MCP server" },
      null,
      2,
    ) + "\n",
  );

  log.success(`Created server: servers/${name}/`);
  log.dim("  Edit index.ts to add your tools, then run:");
  log.dim(`  ai-kit install claude`);
}
