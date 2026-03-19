import { readdirSync, existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

export const AI_KIT_ROOT = resolve(import.meta.dir, "..");
export const SKILLS_DIR = join(AI_KIT_ROOT, "skills");
export const MCPS_DIR = join(AI_KIT_ROOT, "mcps");

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
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
}

export function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { data, body: match[2] };
}

export function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];

  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const skillPath = join(SKILLS_DIR, d.name, "SKILL.md");
      if (!existsSync(skillPath)) return null;

      const content = readFileSync(skillPath, "utf-8");
      const { data, body } = parseFrontmatter(content);

      return {
        name: data.name || d.name,
        description: data.description || "",
        body,
        path: skillPath,
      };
    })
    .filter((s): s is Skill => s !== null);
}

export function loadMcps(): McpConfig[] {
  if (!existsSync(MCPS_DIR)) return [];

  return readdirSync(MCPS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const mcpPath = join(MCPS_DIR, f);
      const content = JSON.parse(readFileSync(mcpPath, "utf-8"));
      return {
        name: f.replace(/\.json$/, ""),
        description: content.description || "",
        config: content.config,
        path: mcpPath,
      };
    });
}
