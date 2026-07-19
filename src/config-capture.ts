import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

import { parse as parseToml } from "smol-toml";

import { loadMcpsFrom, loadServersFrom, MCPS_DIR, SERVERS_DIR } from "./config";
import { defaultConfigDir, expandsPlaceholders, findPlaceholders, isIgnoredEntry } from "./config-tree";
import { log } from "./log";
import { resolveMachineFrom } from "./machine";
import { STATE_PATH } from "./state";
import { stripCodexMcpSections } from "./targets/codex";
import { configRootFor, DESCRIPTORS, type TargetName } from "./targets/descriptors";
import { stripOpencodeMcpEntries } from "./targets/opencode";

const TARGET_NAMES = Object.keys(DESCRIPTORS) as TargetName[];

export interface ConfigCaptureOptions {
  home?: string;
  configDir?: string;
  /** Capture one specific path relative to the config root, even if not curated.
   * Requires an explicit single target. Directories capture recursively. */
  file?: string;
  /** MCP config dirs whose names drive MCP-section stripping (behavior 19). Test
   * seams; default to the repo's `mcps/` and `servers/`. */
  mcpsDir?: string;
  serversDir?: string;
  /** Effective machine name for the overlay-attribution warning (behavior 21) and
   * the state file it resolves from. Test seams; default to the resolved machine
   * (override or normalized hostname) and the real state path. */
  machine?: string;
  statePath?: string;
}

function resolveCaptureTargets(target: string | undefined): TargetName[] {
  if (!target || target === "all") {
    return TARGET_NAMES;
  }
  if (!TARGET_NAMES.includes(target as TargetName)) {
    throw new Error(`Unknown target: ${target}. Available: ${TARGET_NAMES.join(", ")}, all`);
  }
  return [target as TargetName];
}

/** Recursively collect file paths under `dir`, relative to `dir` (POSIX-joined). */
function collectRelPaths(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRelPaths(abs, relPath, out);
    } else if (entry.isFile() && !isIgnoredEntry(entry.name)) {
      out.push(relPath);
    }
  }
}

function isBannedPath(target: TargetName, relPath: string): boolean {
  return DESCRIPTORS[target].bannedConfigPaths.some((b) => relPath === b || relPath.startsWith(`${b}/`));
}

/**
 * Normalize a `--file` value to a config-root-relative POSIX path, rejecting any
 * value that would escape the config root (`..`, absolute paths). Throws with the
 * offending value and the root so the caller need not add context.
 */
function normalizeFileArg(target: TargetName, configRoot: string, file: string): string {
  const abs = resolve(configRoot, file);
  const rel = relative(configRoot, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `--file ${file} resolves outside ${target}'s config root (${configRoot}); ` +
        `capture only reaches paths under the config root.`,
    );
  }
  return rel.split(sep).join("/");
}

/**
 * Determine the set of config-root-relative paths to capture for one target.
 *
 * With `fileArg`: exactly that path (recursive when it's a directory), after
 * rejecting escapes and banned paths and confirming it exists on the machine.
 *
 * Without `fileArg`: the union of (a) files already tracked in the base tree
 * `config/<target>/` — read raw, so capture compares against the repo, not an
 * overlay-merged view — and (b) curated well-known files/dirs from the descriptor
 * that exist under the machine's config root. Banned paths are never captured
 * implicitly. Tracked paths absent on the machine are returned as `missing`, not
 * captured, and are left untouched in the repo.
 */
function patchToCapture(
  target: TargetName,
  configRoot: string,
  baseTargetDir: string,
  fileArg: string | undefined,
): { capture: string[]; missing: string[] } {
  if (fileArg !== undefined) {
    const rel = normalizeFileArg(target, configRoot, fileArg);
    if (isBannedPath(target, rel)) {
      throw new Error(
        `--file ${fileArg} points inside ${target}'s "${rel.split("/")[0]}/" — ai-kit's own ` +
          `skill-install output (runtime state), not shippable config. It is never captured.`,
      );
    }
    const abs = join(configRoot, rel);
    if (!existsSync(abs)) {
      throw new Error(`--file ${fileArg} not found on this machine at ${abs}`);
    }
    if (statSync(abs).isDirectory()) {
      const nested: string[] = [];
      collectRelPaths(abs, rel, nested);
      return { capture: nested, missing: [] };
    }
    return { capture: [rel], missing: [] };
  }

  const tracked: string[] = [];
  if (existsSync(baseTargetDir)) {
    collectRelPaths(baseTargetDir, "", tracked);
  }

  const curated: string[] = [];
  for (const entry of DESCRIPTORS[target].curatedFiles) {
    if (entry.endsWith("/")) {
      const dirRel = entry.slice(0, -1);
      const absDir = join(configRoot, dirRel);
      if (existsSync(absDir) && statSync(absDir).isDirectory()) {
        collectRelPaths(absDir, dirRel, curated);
      }
    } else {
      const abs = join(configRoot, entry);
      if (existsSync(abs) && statSync(abs).isFile()) {
        curated.push(entry);
      }
    }
  }

  const union = new Set<string>();
  for (const rel of [...tracked, ...curated]) {
    if (!isBannedPath(target, rel)) {
      union.add(rel);
    }
  }

  const capture: string[] = [];
  const missing: string[] = [];
  for (const rel of union) {
    if (existsSync(join(configRoot, rel))) {
      capture.push(rel);
    } else {
      missing.push(rel);
    }
  }
  return { capture, missing };
}

/**
 * Strip ai-kit-rendered MCP sections from a captured managed file (behavior 19):
 * Codex's `config.toml` (TOML sections) and OpenCode's `opencode.json` (`mcp`
 * entries), keyed by `mcpNames`. Non-managed files return `undefined` so the caller
 * keeps copying raw bytes.
 */
function stripManagedMcps(target: TargetName, rel: string, src: string, mcpNames: string[]): string | undefined {
  if (!DESCRIPTORS[target].mcpManagedFiles.includes(rel)) {
    return undefined;
  }
  const raw = readFileSync(src, "utf-8");
  if (target === "codex") {
    return stripCodexMcpSections(raw, mcpNames);
  }
  if (target === "opencode") {
    return stripOpencodeMcpEntries(raw, mcpNames);
  }
  return undefined;
}

/**
 * Placeholder-replacement warning (behavior 20): if the existing repo copy carried
 * `${VAR}` placeholders that the incoming captured content no longer contains, warn
 * — the nudge to re-placeholder before committing. Capture never reverse-
 * substitutes; the concrete content is still written and git diff is the review
 * layer. `getIncoming` is lazy so no read happens when the repo copy had no
 * placeholders.
 */
function warnPlaceholderReplacement(
  target: TargetName,
  rel: string,
  repoContent: string,
  getIncoming: () => string,
): void {
  const placeholders = findPlaceholders(repoContent);
  if (placeholders.length === 0) {
    return;
  }
  const incoming = getIncoming();
  const replaced = placeholders.filter((name) => !incoming.includes(`\${${name}}`));
  if (replaced.length === 0) {
    return;
  }
  log.warn(
    `config/${target}/${rel}: repo copy used ${replaced.map((name) => `\${${name}}`).join(", ")} ` +
      `but the captured value is concrete — re-placeholder before committing.`,
  );
}

/**
 * Overlay-attribution warning (behavior 21): capture writes only the base tree, so
 * warn when the effective machine's overlay contributes to a captured file, lest a
 * machine-local value silently become the base for every machine. For deep-merged
 * files (json/toml) name the overlay's top-level keys; any other type is an
 * overlay wholesale replacement.
 */
function warnOverlayAttribution(target: TargetName, machine: string, overlayPath: string, rel: string): void {
  if (!existsSync(overlayPath)) {
    return;
  }
  const label = `config/@${machine}/${target}/${rel}`;
  if (rel.endsWith(".json") || rel.endsWith(".toml")) {
    const content = readFileSync(overlayPath, "utf-8");
    const parsed = (rel.endsWith(".json") ? JSON.parse(content) : parseToml(content)) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    log.warn(
      `${label} overlays ${keys.length > 0 ? keys.join(", ") : "(no keys)"} on ${machine}; ` +
        `capture writes the base tree — re-apply as an overlay if this value is machine-local.`,
    );
    return;
  }
  log.warn(
    `${label} replaces this file on ${machine}; ` +
      `capture writes the base tree — re-apply as an overlay if this content is machine-local.`,
  );
}

function captureTarget(
  target: TargetName,
  home: string,
  configDir: string,
  fileArg: string | undefined,
  mcpNames: string[],
  machine: string,
): void {
  const configRoot = configRootFor(target, home);
  const baseTargetDir = join(configDir, target);
  const { capture, missing } = patchToCapture(target, configRoot, baseTargetDir, fileArg);

  log.heading(`Capturing ${target} config`);

  const overlayTargetDir = join(configDir, `@${machine}`, target);
  const hasOverlay = existsSync(overlayTargetDir);

  for (const rel of capture.toSorted()) {
    const src = join(configRoot, rel);
    const dest = join(baseTargetDir, rel);

    const stripped = stripManagedMcps(target, rel, src, mcpNames);

    if (existsSync(dest) && expandsPlaceholders(rel)) {
      warnPlaceholderReplacement(
        target,
        rel,
        readFileSync(dest, "utf-8"),
        () => stripped ?? readFileSync(src, "utf-8"),
      );
    }
    if (hasOverlay) {
      warnOverlayAttribution(target, machine, join(overlayTargetDir, rel), rel);
    }

    mkdirSync(dirname(dest), { recursive: true });
    if (stripped !== undefined) {
      writeFileSync(dest, stripped);
    } else {
      cpSync(src, dest);
    }
    log.success(`Captured ${rel} ← ${src}`);
  }

  for (const rel of missing.toSorted()) {
    log.warn(`Missing on this machine: ${rel} — left the repo copy as-is`);
  }

  if (capture.length === 0 && missing.length === 0) {
    log.info(`Nothing to capture for ${target}`);
  }
}

/**
 * `ai-kit config capture [target] [--file <relpath>]` — copy live machine config
 * into the repo BASE tree (`config/<target>/`) for git-diff review (PRD behaviors
 * 16, 17, 18, 22). The day-one seeding path and the drift-reconciliation path.
 *
 * No target captures every target; a target limits to one; `--file` requires an
 * explicit single target. Capture never installs, never touches state hashes, never
 * expands or contracts `${VAR}`, and only ever writes the base tree (never overlay
 * `@` directories). Beyond raw copying it applies three safeguards: it strips
 * ai-kit-rendered MCP sections from the managed files (behavior 19), warns when it
 * overwrites a `${VAR}` placeholder in the repo copy with a concrete value
 * (behavior 20), and warns when the effective machine's overlay contributes to a
 * captured file (behavior 21).
 *
 * `home`/`configDir`, `mcpsDir`/`serversDir`, and `machine`/`statePath` are test
 * seams, defaulting to the real home, repo `config/`, repo `mcps/` + `servers/`,
 * and the resolved machine name from the real state file.
 */
export function configCapture(target?: string, options: ConfigCaptureOptions = {}): void {
  const home = options.home ?? homedir();
  const configDir = options.configDir ?? defaultConfigDir();
  const fileArg = options.file;
  const mcpsDir = options.mcpsDir ?? MCPS_DIR;
  const serversDir = options.serversDir ?? SERVERS_DIR;
  const statePath = options.statePath ?? STATE_PATH;
  const machine = options.machine ?? resolveMachineFrom(statePath).name;

  if (fileArg !== undefined && (!target || target === "all")) {
    throw new Error("--file requires an explicit target: ai-kit config capture <target> --file <path>");
  }

  const mcpNames = [...loadMcpsFrom(mcpsDir), ...loadServersFrom(serversDir)].map((mcp) => mcp.name);

  const targets = resolveCaptureTargets(target);
  for (const t of targets) {
    captureTarget(t, home, configDir, fileArg, mcpNames, machine);
  }

  log.info("Review the captured files with git diff, then commit.");
}
