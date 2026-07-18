import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

import { log } from "./log";
import { DESCRIPTORS, type TargetName } from "./targets/descriptors";

export const CONFIG_DIR = "config";
const CONFIG_ROOT = resolve(import.meta.dir, "..", CONFIG_DIR);

export interface ConfigFile {
  /** Destination path relative to the target's config root. */
  relPath: string;
  content: string;
}

export type ConfigTree = Record<TargetName, ConfigFile[]>;

const TARGET_NAMES = new Set(Object.keys(DESCRIPTORS) as TargetName[]);

function emptyTree(): ConfigTree {
  return { claude: [], codex: [], pi: [], opencode: [] };
}

/** Recursively collect files under `dir`, keyed by path relative to `dir`. */
function collectFiles(dir: string, prefix: string, out: ConfigFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(abs, relPath, out);
    } else if (entry.isFile()) {
      out.push({ relPath, content: readFileSync(abs, "utf-8") });
    }
  }
}

function assertNoBannedPaths(target: TargetName, files: ConfigFile[]): void {
  const banned = DESCRIPTORS[target].bannedConfigPaths;
  if (banned.length === 0) {
    return;
  }
  for (const file of files) {
    for (const bannedPath of banned) {
      if (file.relPath === bannedPath || file.relPath.startsWith(`${bannedPath}/`)) {
        throw new Error(
          `Refusing to ship config/${target}/${file.relPath}: "${bannedPath}/" under ${target}'s config is ` +
            `ai-kit's own skill-install output (runtime state), not shippable config. Remove it from the config tree.`,
        );
      }
    }
  }
}

/**
 * Scan a config directory (the `config/` folder itself) and return per-target
 * file sets. Directories starting with `@` are machine overlays handled by a
 * later slice and are ignored here; unknown directory names are warned and
 * skipped. Missing or empty dir → empty sets.
 */
export function loadConfigTreeFrom(dir: string): ConfigTree {
  const tree = emptyTree();
  if (!existsSync(dir)) {
    return tree;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith("@")) {
      continue;
    }
    if (!TARGET_NAMES.has(entry.name as TargetName)) {
      log.warn(`Ignoring unknown directory in config/: ${entry.name}`);
      continue;
    }

    const target = entry.name as TargetName;
    const files: ConfigFile[] = [];
    collectFiles(join(dir, entry.name), "", files);
    assertNoBannedPaths(target, files);
    tree[target] = files;
  }

  return tree;
}

export function loadConfigTree(): ConfigTree {
  return loadConfigTreeFrom(CONFIG_ROOT);
}

/** Matches every `${VAR}` placeholder (VAR = a shell-style identifier). Global so
 * `String.replace` walks all occurrences, including ones adjacent to other text. */
const CONFIG_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Expand every `${VAR}` placeholder in `content` from `env`, returning the
 * expanded string plus the names of referenced-but-unset variables (deduplicated,
 * in order of first appearance). Unlike the MCP placeholder helpers in config.ts
 * — which pass placeholders through to the harness untouched and only match a
 * value that is *exactly* a placeholder — this is plain string substitution:
 * multiple vars per file and placeholders adjacent to text (`Bearer ${TOKEN}`,
 * `${HOME}/bin/x`) all expand. Config files must be fully materialized here
 * because harnesses don't resolve `${VAR}` in their settings files.
 *
 * No escaping mechanism exists in v1: a literal `${...}` cannot be expressed, so
 * config files that need a literal `${` sequence are out of scope. An unset
 * variable leaves its placeholder in place and is reported via `missing`; the
 * caller skips such files rather than installing a half-expanded file.
 */
export function expandEnvVars(
  content: string,
  env: Record<string, string | undefined>,
): { content: string; missing: string[] } {
  const missing: string[] = [];
  const expanded = content.replace(CONFIG_VAR_PATTERN, (match, name: string) => {
    const value = env[name];
    if (value === undefined) {
      if (!missing.includes(name)) {
        missing.push(name);
      }
      return match;
    }
    return value;
  });
  return { content: expanded, missing };
}
