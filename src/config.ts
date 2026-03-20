import { readdirSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

export const AI_KIT_ROOT = resolve(import.meta.dir, "..");
export const SKILLS_DIR = join(AI_KIT_ROOT, "skills");
export const MCPS_DIR = join(AI_KIT_ROOT, "mcps");
export const SERVERS_DIR = join(AI_KIT_ROOT, "servers");

export interface SkillSource {
  from: string;
  skill: string;
  fetchedAt: string;
}

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  source?: SkillSource;
}

export interface McpConfig {
  name: string;
  description: string;
  config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  path: string;
  isLocal?: boolean;
}

export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: normalized };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { data, body: match[2] };
}

export function loadSkillsFrom(dir: string): Skill[] {
  if (!existsSync(dir)) return [];

  const skills: Skill[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const skillPath = join(dir, d.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;

    const content = readFileSync(skillPath, "utf-8");
    const { data, body } = parseFrontmatter(content);

    const sourcePath = join(dir, d.name, "source.json");
    const source: SkillSource | undefined = existsSync(sourcePath)
      ? JSON.parse(readFileSync(sourcePath, "utf-8"))
      : undefined;

    skills.push({
      name: data.name || d.name,
      description: data.description || "",
      body,
      path: skillPath,
      source,
    });
  }
  return skills;
}

export function loadSkills(): Skill[] {
  return loadSkillsFrom(SKILLS_DIR);
}

export function loadMcpsFrom(dir: string): McpConfig[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const mcpPath = join(dir, f);
      const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
      if (!content.config || typeof content.config.command !== "string") {
        throw new Error(`Invalid MCP config in ${f}: missing "config.command"`);
      }
      return {
        name: f.replace(/\.json$/, ""),
        description: content.description || "",
        config: content.config,
        path: mcpPath,
      };
    });
}

export function loadServersFrom(dir: string): McpConfig[] {
  if (!existsSync(dir)) return [];

  const servers: McpConfig[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const entryPath = join(dir, d.name, "index.ts");
    if (!existsSync(entryPath)) continue;

    const metaPath = join(dir, d.name, "server.json");
    const meta = existsSync(metaPath)
      ? JSON.parse(readFileSync(metaPath, "utf-8"))
      : {};

    const config: McpConfig["config"] = {
      command: "bun",
      args: ["run", entryPath],
    };
    if (meta.env) config.env = meta.env;

    servers.push({
      name: d.name,
      description: meta.description || "",
      config,
      path: entryPath,
      isLocal: true,
    });
  }
  return servers;
}

export function loadServers(): McpConfig[] {
  return loadServersFrom(SERVERS_DIR);
}

export function loadMcps(): McpConfig[] {
  return [...loadMcpsFrom(MCPS_DIR), ...loadServersFrom(SERVERS_DIR)];
}
