import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

import { createDefu } from "defu";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { log } from "./log";
import { resolveMachineFrom } from "./machine";
import { STATE_PATH } from "./state";
import { DESCRIPTORS, type TargetName } from "./targets/descriptors";

export const CONFIG_DIR = "config";
const CONFIG_ROOT = resolve(import.meta.dir, "..", CONFIG_DIR);

/**
 * Default config-tree directory: the repo's `config/`, overridable via the
 * `AI_KIT_CONFIG_DIR` env var. The env seam exists for subprocess tests that
 * drive the real install/sync flows — without it they would have to plant
 * fixtures inside (and clean up) the live repo tree.
 */
export function defaultConfigDir(): string {
  return process.env.AI_KIT_CONFIG_DIR ?? CONFIG_ROOT;
}

export interface ConfigFile {
  /** Destination path relative to the target's config root. */
  relPath: string;
  /** File content: text as a string, binary files as raw bytes. Binary content
   * never merges, never expands `${VAR}`, and is written/hashed byte-for-byte. */
  content: string | Buffer;
  /**
   * For a file deep-merged with a machine overlay (JSON/TOML): the top-level
   * keys the overlay contributed to the merged result. Consumed by capture's
   * overlay-attribution warning (slice 08). Absent when no overlay touched it.
   */
  overlayKeys?: string[];
  /**
   * True when the whole file's content came from the overlay — either a
   * wholesale replacement of a non-JSON/TOML base file, or an overlay-only file
   * with no base counterpart. Mutually exclusive with `overlayKeys`.
   */
  overlayReplaced?: boolean;
}

export type ConfigTree = Record<TargetName, ConfigFile[]>;

const TARGET_LIST = Object.keys(DESCRIPTORS) as TargetName[];
const TARGET_NAMES = new Set(TARGET_LIST);

function emptyTree(): ConfigTree {
  return { claude: [], codex: [], pi: [], opencode: [] };
}

/** `.gitkeep` markers exist to keep empty tree directories in git — they are
 * never shippable config and are skipped by every collector. */
export function isGitkeep(name: string): boolean {
  return name === ".gitkeep";
}

/** True when `buf` does not round-trip through UTF-8 — treated as binary. */
function isBinary(buf: Buffer): boolean {
  return !Buffer.from(buf.toString("utf-8"), "utf-8").equals(buf);
}

/** Recursively collect files under `dir`, keyed by path relative to `dir`. */
function collectFiles(dir: string, prefix: string, out: ConfigFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(abs, relPath, out);
    } else if (entry.isFile() && !isGitkeep(entry.name)) {
      const buf = readFileSync(abs);
      out.push({ relPath, content: isBinary(buf) ? buf : buf.toString("utf-8") });
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
 * Deep-merge two parsed structures with overlay priority. Objects/tables merge
 * recursively; scalars and arrays in the overlay REPLACE the base's rather than
 * concatenating. Plain `defu` concatenates arrays, so a custom merger assigns the
 * overlay (priority) array outright — the case the PRD's "overlay arrays win"
 * rule turns on. `deepMerge(overlay, base)`: the first argument wins.
 */
const deepMerge = createDefu((obj, key, value) => {
  if (Array.isArray(obj[key]) || Array.isArray(value)) {
    obj[key] = value;
    return true;
  }
  return false;
});

function parseJsonConfig(content: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse JSON config ${label}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

function parseTomlConfig(content: string, label: string): Record<string, unknown> {
  try {
    return parseToml(content);
  } catch (err) {
    throw new Error(`Failed to parse TOML config ${label}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

/**
 * Combine a base file with its machine-overlay counterpart. `.json` and `.toml`
 * deep-merge (overlay wins; objects merge, arrays/scalars replace); any other
 * type is replaced wholesale by the overlay. The returned file carries overlay
 * attribution: `overlayKeys` for merges, `overlayReplaced` for whole-file wins.
 */
function combineFile(target: TargetName, base: ConfigFile, overlay: ConfigFile): ConfigFile {
  const rel = base.relPath;
  const baseLabel = `config/${target}/${rel}`;
  const overlayLabel = `config/@overlay/${target}/${rel}`;
  const baseContent = base.content;
  const overlayContent = overlay.content;

  // Binary content can't deep-merge; only string pairs reach the JSON/TOML paths.
  if (typeof baseContent === "string" && typeof overlayContent === "string") {
    if (rel.endsWith(".json")) {
      const overlayObj = parseJsonConfig(overlayContent, overlayLabel);
      const merged = deepMerge(overlayObj, parseJsonConfig(baseContent, baseLabel));
      return { relPath: rel, content: JSON.stringify(merged, null, 2) + "\n", overlayKeys: Object.keys(overlayObj) };
    }

    if (rel.endsWith(".toml")) {
      const overlayObj = parseTomlConfig(overlayContent, overlayLabel);
      const merged = deepMerge(overlayObj, parseTomlConfig(baseContent, baseLabel));
      return { relPath: rel, content: stringifyToml(merged), overlayKeys: Object.keys(overlayObj) };
    }
  }

  return { relPath: rel, content: overlay.content, overlayReplaced: true };
}

/** Merge an overlay file set over a base set: matching files combine per type,
 * base-only files pass through untouched, overlay-only files install as-is. */
function mergeOverlay(target: TargetName, baseFiles: ConfigFile[], overlayFiles: ConfigFile[]): ConfigFile[] {
  const overlayByPath = new Map(overlayFiles.map((f) => [f.relPath, f]));
  const basePaths = new Set(baseFiles.map((f) => f.relPath));

  const merged: ConfigFile[] = baseFiles.map((base) => {
    const overlay = overlayByPath.get(base.relPath);
    return overlay ? combineFile(target, base, overlay) : base;
  });

  for (const overlay of overlayFiles) {
    if (!basePaths.has(overlay.relPath)) {
      merged.push({ relPath: overlay.relPath, content: overlay.content, overlayReplaced: true });
    }
  }

  return merged;
}

/**
 * Scan a config directory (the `config/` folder itself) and return per-target
 * file sets. When `machine` is given and `config/@<machine>/<target>/` exists,
 * its files deep-merge over the base tree (PRD behavior 5); overlays for any
 * other machine name are ignored. Unknown top-level directory names are warned
 * and skipped. Missing or empty dir → empty sets.
 */
export function loadConfigTreeFrom(dir: string, machine?: string): ConfigTree {
  const tree = emptyTree();
  if (!existsSync(dir)) {
    return tree;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("@") || TARGET_NAMES.has(entry.name as TargetName)) {
      continue;
    }
    log.warn(`Ignoring unknown directory in config/: ${entry.name}`);
  }

  const overlayRoot = machine ? join(dir, `@${machine}`) : undefined;

  for (const target of TARGET_LIST) {
    const baseFiles: ConfigFile[] = [];
    const baseDir = join(dir, target);
    if (existsSync(baseDir)) {
      collectFiles(baseDir, "", baseFiles);
      assertNoBannedPaths(target, baseFiles);
    }

    let files = baseFiles;
    if (overlayRoot) {
      const overlayDir = join(overlayRoot, target);
      if (existsSync(overlayDir)) {
        const overlayFiles: ConfigFile[] = [];
        collectFiles(overlayDir, "", overlayFiles);
        assertNoBannedPaths(target, overlayFiles);
        files = mergeOverlay(target, baseFiles, overlayFiles);
      }
    }
    tree[target] = files;
  }

  return tree;
}

export function loadConfigTree(): ConfigTree {
  return loadConfigTreeFrom(defaultConfigDir(), resolveMachineFrom(STATE_PATH).name);
}

/** One `@<machine>` overlay directory in the config tree. */
export interface ConfigOverlaySummary {
  /** Overlay machine name (the directory name without its leading `@`). */
  machine: string;
  /** Whether this overlay applies to the effective machine being summarized. */
  applies: boolean;
  /** Targets the overlay contributes files to. */
  targets: TargetName[];
}

/** A read-only view of the config tree for `ai-kit list` (PRD behavior 24). */
export interface ConfigTreeSummary {
  /** Raw base file paths per target, from `config/<target>/` (overlays not merged in). */
  base: Record<TargetName, string[]>;
  /** Every `@<machine>` overlay directory found, with applicability to this machine. */
  overlays: ConfigOverlaySummary[];
  /** Effective machine name overlays are matched against. */
  machine: string;
}

/** Recursively collect file paths under `dir`, relative to `dir` (POSIX-joined). */
function collectRelPaths(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      collectRelPaths(join(dir, entry.name), relPath, out);
    } else if (entry.isFile() && !isGitkeep(entry.name)) {
      out.push(relPath);
    }
  }
}

/**
 * Summarize a config directory for `ai-kit list` (PRD behavior 24): the raw base
 * files per target and every `@<machine>` overlay directory, each flagged for
 * whether it applies to `machine`. Reads paths only — no content, no merge, no
 * `${VAR}` expansion. Missing dir → empty summary. Follows the `*From(dir)`
 * convention so the list section is testable against fixture trees.
 */
export function summarizeConfigTreeFrom(dir: string, machine: string): ConfigTreeSummary {
  const base = { claude: [], codex: [], pi: [], opencode: [] } as Record<TargetName, string[]>;
  const overlays: ConfigOverlaySummary[] = [];
  if (!existsSync(dir)) {
    return { base, overlays, machine };
  }

  for (const target of TARGET_LIST) {
    const baseDir = join(dir, target);
    if (existsSync(baseDir)) {
      const rels: string[] = [];
      collectRelPaths(baseDir, "", rels);
      base[target] = rels.toSorted();
    }
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("@")) {
      continue;
    }
    const overlayMachine = entry.name.slice(1);
    const overlayDir = join(dir, entry.name);
    const targets = TARGET_LIST.filter((target) => existsSync(join(overlayDir, target)));
    overlays.push({ machine: overlayMachine, applies: overlayMachine === machine, targets });
  }
  overlays.sort((a, b) => a.machine.localeCompare(b.machine));

  return { base, overlays, machine };
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
/**
 * Names of every `${VAR}` placeholder in `content`, deduplicated in first-seen
 * order. Shares CONFIG_VAR_PATTERN with `expandEnvVars` so capture's
 * placeholder-replacement warning (PRD behavior 20) recognizes exactly the same
 * placeholders the installer expands.
 */
export function findPlaceholders(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(CONFIG_VAR_PATTERN)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}

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
