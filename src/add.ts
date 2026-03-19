import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { SKILLS_DIR, MCPS_DIR } from "./config";
import { log } from "./log";

export interface AddOptions {
  from?: string;
}

export async function add(type: string, name: string, options: AddOptions = {}): Promise<void> {
  if (type === "skill") {
    await addSkill(name, options);
  } else if (type === "mcp") {
    addMcp(name);
  } else {
    log.error(`Unknown type: ${type}. Use "skill" or "mcp".`);
    process.exit(1);
  }
}

function normalizeGitHubUrl(url: string): string {
  // Already a raw URL
  if (url.includes("raw.githubusercontent.com")) return url;

  // GitHub blob URL → raw
  // https://github.com/owner/repo/blob/branch/path/SKILL.md
  const blobMatch = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
  );
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
  }

  // GitHub tree URL (directory) → raw + /SKILL.md
  // https://github.com/owner/repo/tree/branch/path/to/skill
  const treeMatch = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/(.+)$/,
  );
  if (treeMatch) {
    const path = treeMatch[2].replace(/\/$/, "");
    return `https://raw.githubusercontent.com/${treeMatch[1]}/${path}/SKILL.md`;
  }

  // Not a recognized GitHub URL — return as-is
  return url;
}

async function addSkill(name: string, options: AddOptions): Promise<void> {
  const dir = join(SKILLS_DIR, name);
  const filePath = join(dir, "SKILL.md");

  if (existsSync(filePath)) {
    log.error(`Skill already exists: ${name}`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });

  if (options.from) {
    const rawUrl = normalizeGitHubUrl(options.from);
    log.info(`Fetching from ${rawUrl}`);

    const response = await fetch(rawUrl);
    if (!response.ok) {
      log.error(`Failed to fetch: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const content = await response.text();
    writeFileSync(filePath, content);
    writeFileSync(
      join(dir, "source.json"),
      JSON.stringify(
        { url: rawUrl, fetchedAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );

    log.success(`Fetched skill: skills/${name}/SKILL.md`);
    log.dim(`  Source: ${rawUrl}`);
  } else {
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
