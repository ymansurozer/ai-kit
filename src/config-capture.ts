import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "path";

import { loadMcpsFrom, loadServersFrom, MCPS_DIR, SERVERS_DIR } from "./config";
import { defaultConfigDir, expandsPlaceholders, findPlaceholders, isIgnoredDir, isIgnoredEntry } from "./config-tree";
import { log } from "./log";
import { resolveMachineFrom } from "./machine";
import { loadMachineOwnedFrom, type MachineOwnedKeys } from "./machine-owned";
import { spliceOwnedKeys } from "./owned-keys";
import { STATE_PATH } from "./state";
import { parseStructured, structuredKind, type StructuredKind } from "./structured";
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
      if (!isIgnoredDir(entry.name)) {
        collectRelPaths(abs, relPath, out);
      }
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
    return stripOpencodeMcpEntries(raw, mcpNames, src);
  }
  return undefined;
}

/** An empty document in `kind`, standing in for a repo copy that does not exist
 * yet: it has no state for any key, so every machine-owned key drops. */
function emptyDocument(kind: StructuredKind): string {
  return kind === "json" ? "{}" : "";
}

/**
 * Apply the never-cross rule to one captured file (machine-owned PRD behavior 6):
 * the captured copy is the machine's content carrying the REPO's state — value or
 * absence — for every machine-owned key, so a machine's value for such a key can
 * never travel into the repo. Repo defaults for owned keys are authored by hand.
 *
 * This is the install-time splice with its two sides swapped: install builds on the
 * repo's content and takes owned keys from the destination, capture builds on the
 * machine's content and takes them from the repo copy — absence included, which is
 * how a machine-only owned key gets dropped. `basePath` is the repo BASE copy
 * (capture never reads or writes an overlay); a repo copy that does not exist yet
 * has state for nothing, so every owned key drops.
 *
 * Each owned key gets a line naming the file and the key: kept from the repo, or
 * dropped from the machine. Returns `undefined` when either side fails to parse,
 * having warned — the repo copy is then left exactly as it was, because copying the
 * machine's bytes raw would leak the very keys this rule exists to keep out
 * (machine-owned PRD behavior 12: never-cross outweighs capture completeness).
 */
function restoreOwnedKeys(
  target: TargetName,
  rel: string,
  machineContent: string,
  machinePath: string,
  basePath: string,
  keys: string[],
  kind: StructuredKind,
): string | undefined {
  const repoLabel = `config/${target}/${rel}`;
  const repoContent = existsSync(basePath) ? readFileSync(basePath, "utf-8") : emptyDocument(kind);
  try {
    // Parsed here for the per-key report; the splice re-parses both sides, which is
    // the price of keeping one primitive shared with install.
    const machineParsed = parseStructured(kind, machineContent, machinePath);
    const repoParsed = parseStructured(kind, repoContent, repoLabel);
    for (const key of keys) {
      if (key in repoParsed) {
        log.info(`${repoLabel}: kept the repo's "${key}" — machine-owned, this machine's value stays here`);
      } else if (key in machineParsed) {
        log.warn(`${repoLabel}: dropped this machine's "${key}" — machine-owned and the repo copy declares none`);
      }
    }
    // Sides swapped against the parameter names: `repo` is the base being built on
    // (the machine's content), `dest` is the side owned keys are taken from (the
    // repo copy).
    return spliceOwnedKeys(machineContent, repoContent, keys, kind, { repo: machinePath, dest: repoLabel });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(
      `Skipped ${rel}: ${detail} — it declares machine-owned keys, and capturing it raw would leak them into the repo`,
    );
    return undefined;
  }
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
  const kind = structuredKind(rel);
  if (kind) {
    const parsed = parseStructured(kind, readFileSync(overlayPath, "utf-8"), overlayPath);
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
  machineOwned: MachineOwnedKeys,
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

    // `undefined` all the way through means "no transform applies" — the file is
    // copied byte-for-byte, exactly as it was before either transform existed.
    let transformed = stripManagedMcps(target, rel, src, mcpNames);

    const keys = machineOwned.ownedKeysFor(target, rel);
    // Per-key ownership needs parseable text; the manifest loader already rejects
    // other extensions, so this only ever guards against a stale declaration.
    const kind = keys.length > 0 ? structuredKind(rel) : null;
    if (kind !== null) {
      // Both transforms apply, in this order: the MCP strip works on the raw string,
      // and its output is the machine content the owned-key restore builds on.
      const restored = restoreOwnedKeys(target, rel, transformed ?? readFileSync(src, "utf-8"), src, dest, keys, kind);
      if (restored === undefined) {
        continue;
      }
      transformed = restored;
    }

    if (existsSync(dest) && expandsPlaceholders(rel)) {
      warnPlaceholderReplacement(
        target,
        rel,
        readFileSync(dest, "utf-8"),
        () => transformed ?? readFileSync(src, "utf-8"),
      );
    }
    if (hasOverlay) {
      warnOverlayAttribution(target, machine, join(overlayTargetDir, rel), rel);
    }

    mkdirSync(dirname(dest), { recursive: true });
    if (transformed !== undefined) {
      writeFileSync(dest, transformed);
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
 * `@` directories). Beyond raw copying it applies four safeguards: it strips
 * ai-kit-rendered MCP sections from the managed files (behavior 19), warns when it
 * overwrites a `${VAR}` placeholder in the repo copy with a concrete value
 * (behavior 20), warns when the effective machine's overlay contributes to a
 * captured file (behavior 21), and keeps machine-owned keys at the repo's state so
 * they never cross into the repo (machine-owned PRD behavior 6).
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
  // Read once for the whole run, before anything is written: a malformed manifest
  // must abort every target rather than let the first one's machine-owned values
  // cross into the repo (machine-owned PRD behavior 10).
  const machineOwned = loadMachineOwnedFrom(configDir);

  const targets = resolveCaptureTargets(target);
  for (const t of targets) {
    captureTarget(t, home, configDir, fileArg, mcpNames, machine, machineOwned);
  }

  log.info("Review the captured files with git diff, then commit.");
}
