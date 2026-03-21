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

export type StdioMcpTransportConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  [key: string]: unknown;
};

export type HttpMcpTransportConfig = {
  url: string;
  [key: string]: unknown;
};

export interface McpConfig {
  name: string;
  description: string;
  config: StdioMcpTransportConfig | HttpMcpTransportConfig;
  path: string;
  isLocal?: boolean;
}

const ENV_VAR_PATTERN = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const BEARER_ENV_VAR_PATTERN = /^Bearer \${([A-Za-z_][A-Za-z0-9_]*)\}$/;

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

export function extractEnvVar(value: string): string | null {
  return value.match(ENV_VAR_PATTERN)?.[1] ?? null;
}

export function extractBearerTokenEnvVar(value: string): string | null {
  return value.match(BEARER_ENV_VAR_PATTERN)?.[1] ?? null;
}

export function containsEnvPlaceholderSyntax(value: string): boolean {
  return value.includes("${");
}

export function transformEnvVars<T>(
  value: T,
  transform: (varName: string) => string,
): T {
  if (typeof value === "string") {
    const envVar = extractEnvVar(value);
    if (envVar) return transform(envVar) as T;

    const bearerEnvVar = extractBearerTokenEnvVar(value);
    if (bearerEnvVar) return `Bearer ${transform(bearerEnvVar)}` as T;

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => transformEnvVars(item, transform)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        transformEnvVars(item, transform),
      ]),
    ) as T;
  }

  return value;
}

export function loadMcpsFrom(dir: string): McpConfig[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const mcpPath = join(dir, f);
      const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
      const config = content.config as Record<string, unknown> | undefined;
      if (
        !config ||
        (typeof config.command !== "string" && typeof config.url !== "string")
      ) {
        throw new Error(
          `Invalid MCP config in ${f}: missing "config.command" or "config.url"`,
        );
      }
      return {
        name: f.replace(/\.json$/, ""),
        description: content.description || "",
        config: config as McpConfig["config"],
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
