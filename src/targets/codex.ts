import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import {
  containsEnvPlaceholderSyntax,
  extractBearerTokenEnvVar,
  extractEnvVar,
  type Skill,
  type McpConfig,
  type StdioMcpTransportConfig,
  type HttpMcpTransportConfig,
} from "../config";
import { installSkillsToDir } from "./shared";
import { log } from "../log";

interface TomlSection {
  name: string;
  lines: string[];
  start: number;
  end: number;
}

const OWNED_ROOT_KEYS = new Set([
  "command",
  "url",
  "args",
  "env_vars",
  "bearer_token_env_var",
]);
const OWNED_SUBSECTIONS = new Set([
  "env",
  "http_headers",
  "env_http_headers",
]);

export function installCodex(
  skills: Skill[],
  mcps: McpConfig[],
  global: boolean,
  cwd: string,
): void {
  if (global) {
    installSkillsToDir(skills, join(homedir(), ".agents", "skills"), "~/.agents/skills");
    installMcpsGlobal(mcps);
  } else {
    installSkillsToDir(skills, join(cwd, ".agents", "skills"), ".agents/skills");
    installMcpsLocal(mcps, cwd);
  }
}

function installMcpsLocal(mcps: McpConfig[], cwd: string): void {
  if (mcps.length === 0) return;
  const configPath = join(cwd, ".codex", "config.toml");
  mergeMcpsToml(mcps, configPath, ".codex/config.toml");
}

function installMcpsGlobal(mcps: McpConfig[]): void {
  if (mcps.length === 0) return;
  const configPath = join(homedir(), ".codex", "config.toml");
  mergeMcpsToml(mcps, configPath, "~/.codex/config.toml");
}

function mergeMcpsToml(
  mcps: McpConfig[],
  configPath: string,
  displayPath: string,
): void {
  mkdirSync(dirname(configPath), { recursive: true });

  let content = "";
  if (existsSync(configPath)) {
    content = readFileSync(configPath, "utf-8");
  }

  for (const mcp of mcps) {
    const sectionPrefix = `mcp_servers.${mcp.name}`;
    const section = buildTomlSection(mcp);
    content = mergeTomlSection(content, section, sectionPrefix);
    log.success(`Installed MCP ${mcp.name} → ${displayPath}`);
  }

  writeFileSync(configPath, content.trimEnd() + "\n");
}

export function removeTomlSection(content: string, sectionPrefix: string): string {
  return extractTomlSections(content, sectionPrefix).content;
}

export function buildTomlSection(mcp: McpConfig): string {
  if ("url" in mcp.config && typeof mcp.config.url === "string") {
    return buildHttpTomlSection(mcp.name, mcp.config as HttpMcpTransportConfig);
  }

  return buildStdioTomlSection(mcp.name, mcp.config as StdioMcpTransportConfig);
}

function buildStdioTomlSection(
  name: string,
  config: StdioMcpTransportConfig,
): string {
  assertNoUnsupportedPlaceholder(name, "command", config.command);

  let section = `[mcp_servers.${name}]\n`;
  section += `command = ${tomlString(config.command)}\n`;

  if (config.args) {
    for (const [index, value] of config.args.entries()) {
      assertNoUnsupportedPlaceholder(name, `args[${index}]`, value);
    }
    section += `args = [${config.args.map(tomlString).join(", ")}]\n`;
  }

  const envLines: string[] = [];
  const envVars: string[] = [];
  if (config.env) {
    for (const [key, value] of Object.entries(config.env)) {
      const envVar = extractEnvVar(value);
      if (envVar) {
        if (envVar !== key) {
          throw new Error(
            `Unsupported MCP config for ${name}: env.${key} references ${envVar}, but Codex only forwards same-name variables via env_vars`,
          );
        }
        envVars.push(envVar);
        continue;
      }

      assertNoUnsupportedPlaceholder(name, `env.${key}`, value);
      envLines.push(`${key} = ${tomlString(value)}`);
    }
  }

  if (envVars.length > 0) {
    section += `env_vars = [${envVars.map(tomlString).join(", ")}]\n`;
  }

  if (envLines.length > 0) {
    section += `\n[mcp_servers.${name}.env]\n`;
    section += `${envLines.join("\n")}\n`;
  }

  return section;
}

function buildHttpTomlSection(
  name: string,
  config: HttpMcpTransportConfig,
): string {
  assertNoUnsupportedPlaceholder(name, "url", config.url);

  let section = `[mcp_servers.${name}]\n`;
  section += `url = ${tomlString(config.url)}\n`;

  const staticHeaders: string[] = [];
  const envHeaders: string[] = [];
  let bearerTokenEnvVar: string | null = null;

  const headers = config.headers;
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== "string") {
        throw new Error(
          `Unsupported MCP config for ${name}: headers.${key} must be a string for Codex`,
        );
      }

      const bearerEnvVar = extractBearerTokenEnvVar(value);
      if (key === "Authorization" && bearerEnvVar) {
        bearerTokenEnvVar = bearerEnvVar;
        continue;
      }

      const envVar = extractEnvVar(value);
      if (envVar) {
        envHeaders.push(`${key} = ${tomlString(envVar)}`);
        continue;
      }

      assertNoUnsupportedPlaceholder(name, `headers.${key}`, value);
      staticHeaders.push(`${key} = ${tomlString(value)}`);
    }
  }

  if (bearerTokenEnvVar) {
    section += `bearer_token_env_var = ${tomlString(bearerTokenEnvVar)}\n`;
  }

  if (staticHeaders.length > 0) {
    section += `\n[mcp_servers.${name}.http_headers]\n`;
    section += `${staticHeaders.join("\n")}\n`;
  }

  if (envHeaders.length > 0) {
    section += `\n[mcp_servers.${name}.env_http_headers]\n`;
    section += `${envHeaders.join("\n")}\n`;
  }

  return section;
}

function extractTomlSections(
  content: string,
  sectionPrefix: string,
): { content: string; sections: TomlSection[]; found: boolean } {
  const marker = "__AI_KIT_TOML_SECTION__";
  const lines = content.split("\n");
  const parsedSections = parseTomlSections(content);
  const sections = parsedSections.filter(
    (section) =>
      section.name === sectionPrefix ||
      section.name.startsWith(sectionPrefix + "."),
  );
  if (sections.length === 0) {
    return {
      content,
      sections: [],
      found: false,
    };
  }

  const firstStart = Math.min(...sections.map((section) => section.start));
  const skippedLines = new Set<number>();
  for (const section of sections) {
    for (let index = section.start; index <= section.end; index++) {
      skippedLines.add(index);
    }
  }

  const result: string[] = [];
  let insertedMarker = false;
  for (const [index, line] of lines.entries()) {
    if (skippedLines.has(index)) {
      if (!insertedMarker && index === firstStart) {
        result.push(marker);
        insertedMarker = true;
      }
      continue;
    }

    result.push(line);
  }

  return {
    content: result.join("\n"),
    sections,
    found: true,
  };
}

function getTomlSectionName(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[")) return null;

  const closeBracket = trimmed.indexOf("]");
  if (closeBracket === -1) return null;

  return trimmed.slice(1, closeBracket);
}

function getTomlKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
  return match?.[1] ?? null;
}

function mergeTomlSection(
  existing: string,
  emitted: string,
  sectionPrefix: string,
): string {
  const extracted = extractTomlSections(existing, sectionPrefix);
  const emittedSections = parseTomlSections(emitted);
  const mergedSection = renderTomlSections(
    mergeTomlSections(extracted.sections, emittedSections),
  );

  if (extracted.found) {
    return extracted.content.replace("__AI_KIT_TOML_SECTION__", mergedSection);
  }

  const base = extracted.content.trimEnd();
  return `${base}${base ? "\n\n" : ""}${mergedSection}`;
}

function parseTomlSections(content: string): TomlSection[] {
  const lines = content.split("\n");
  const sections: TomlSection[] = [];
  let currentSection: TomlSection | null = null;

  for (const [index, line] of lines.entries()) {
    const sectionName = getTomlSectionName(line);
    if (sectionName) {
      if (currentSection) {
        currentSection.end = index - 1;
        sections.push(currentSection);
      }
      currentSection = { name: sectionName, lines: [], start: index, end: index };
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
      currentSection.end = index;
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

function mergeTomlSections(
  existingSections: TomlSection[],
  emittedSections: TomlSection[],
): TomlSection[] {
  if (emittedSections.length === 0) return existingSections;

  const rootName = emittedSections[0].name;
  const existingByName = new Map(existingSections.map((section) => [section.name, section]));
  const emittedByName = new Map(emittedSections.map((section) => [section.name, section]));
  const emittedRoot = emittedSections[0];
  const existingRoot = existingByName.get(rootName);

  const merged: TomlSection[] = [
    {
      name: rootName,
      lines: [
        ...(existingRoot?.lines.filter((line) => {
          const key = getTomlKey(line);
          return !key || !OWNED_ROOT_KEYS.has(key);
        }) ?? []),
        ...emittedRoot.lines,
      ],
    },
  ];

  const added = new Set<string>();
  for (const section of existingSections) {
    if (section.name === rootName) continue;

    const subsectionName = section.name.slice(rootName.length + 1);
    if (OWNED_SUBSECTIONS.has(subsectionName)) {
      const emittedSection = emittedByName.get(section.name);
      if (emittedSection) {
        merged.push(emittedSection);
        added.add(section.name);
      }
      continue;
    }

    const emittedSection = emittedByName.get(section.name);
    if (emittedSection) {
      merged.push(emittedSection);
      added.add(section.name);
      continue;
    }

    merged.push(section);
  }

  for (const section of emittedSections.slice(1)) {
    if (added.has(section.name)) continue;
    if (!existingByName.has(section.name)) {
      merged.push(section);
    }
  }

  return merged;
}

function renderTomlSections(sections: TomlSection[]): string {
  return sections
    .map((section) => {
      const body = section.lines.join("\n").replace(/\n+$/g, "");
      return body ? `[${section.name}]\n${body}` : `[${section.name}]`;
    })
    .join("\n\n");
}

function assertNoUnsupportedPlaceholder(
  mcpName: string,
  field: string,
  value: string,
): void {
  if (!containsEnvPlaceholderSyntax(value)) return;
  if (extractEnvVar(value) || extractBearerTokenEnvVar(value)) return;

  throw new Error(
    `Unsupported MCP config for ${mcpName}: ${field} uses unsupported placeholder interpolation. Only exact \${VAR} and Authorization: Bearer \${VAR} are supported`,
  );
}

export function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
