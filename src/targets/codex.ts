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
    content = removeTomlSection(content, `mcp_servers.${mcp.name}`);
    const section = buildTomlSection(mcp);
    content = content.trimEnd() + (content.trim() ? "\n\n" : "") + section;
    log.success(`Installed MCP ${mcp.name} → ${displayPath}`);
  }

  writeFileSync(configPath, content.trimEnd() + "\n");
}

export function removeTomlSection(content: string, sectionPrefix: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      const closeBracket = trimmed.indexOf("]");
      const sectionName = trimmed.slice(1, closeBracket);
      if (
        sectionName === sectionPrefix ||
        sectionName.startsWith(sectionPrefix + ".")
      ) {
        skipping = true;
        continue;
      } else {
        skipping = false;
      }
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
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
