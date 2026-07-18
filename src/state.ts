import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

export const STATE_DIR = join(homedir(), ".ai-kit");
export const STATE_PATH = join(STATE_DIR, "state.json");

export interface Installation {
  target: string;
  global: boolean;
  path?: string;
  // A selection: an explicit list, or `undefined` meaning "all — re-scan the repo
  // every sync". A full (non-cherry-picked) install records `undefined` so that
  // additions and removals in the repo propagate; a cherry-picked install records
  // its explicit list. See `mergeSelection` for how repeated installs combine.
  skills?: string[];
  mcps?: string[];
  // Whether this global install includes the harness config tree. Once set it
  // sticks across subsequent installs of the same key (see `saveInstallationTo`).
  config?: boolean;
  // sha256 of the content ai-kit last wrote for each config destination, keyed by
  // the destination-relative path (ConfigFile.relPath). Drives drift detection:
  // absence of a key means "never written by ai-kit". Older state files lack this
  // map entirely — valid, no migration. Merged per-key on save (see below).
  configFiles?: Record<string, string>;
  installedAt: string;
}

export interface State {
  installations: Installation[];
  // Optional override for this machine's overlay-resolution name. Absent means
  // "use the normalized hostname" (see machine.ts). Older state files lack it.
  machine?: string;
}

export function readStateFrom(path: string): State {
  if (!existsSync(path)) {
    return { installations: [] };
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeStateTo(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Combine a prior selection with a new one, monotonically: "all" (undefined) wins,
 * otherwise union the two lists. A selection only ever widens through install, so
 * sync never silently stops syncing something a previous install asked for. To
 * narrow a selection, edit state.json directly.
 */
export function mergeSelection(prev: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (prev === undefined || next === undefined) {
    return undefined;
  }
  return [...new Set([...prev, ...next])];
}

/**
 * Merge recorded config-file hashes: new hashes (files written this run) win over
 * previous ones per key; files not written this run keep their previously recorded
 * hash. Returns undefined only when neither side has any entries.
 */
export function mergeConfigFiles(
  prev: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (prev === undefined && next === undefined) {
    return undefined;
  }
  return { ...prev, ...next };
}

/** Find the installation entry matching (target, global, path), if any. */
export function findInstallationFrom(
  path: string,
  target: string,
  global: boolean,
  installPath: string | undefined,
): Installation | undefined {
  return readStateFrom(path).installations.find(
    (i) => i.target === target && i.global === global && i.path === installPath,
  );
}

export function saveInstallationTo(path: string, installation: Installation): void {
  const state = readStateFrom(path);

  const idx = state.installations.findIndex(
    (i) => i.target === installation.target && i.global === installation.global && i.path === installation.path,
  );

  if (idx >= 0) {
    const prev = state.installations[idx];
    state.installations[idx] = {
      ...installation,
      skills: mergeSelection(prev.skills, installation.skills),
      mcps: mergeSelection(prev.mcps, installation.mcps),
      config: installation.config || prev.config,
      configFiles: mergeConfigFiles(prev.configFiles, installation.configFiles),
    };
  } else {
    state.installations.push(installation);
  }

  writeStateTo(path, state);
}

/** Read the stored machine-name override, if any (top-level `machine` field). */
export function readMachineOverrideFrom(path: string): string | undefined {
  return readStateFrom(path).machine;
}

/** Store a machine-name override, preserving the rest of state. */
export function saveMachineOverrideTo(path: string, name: string): void {
  const state = readStateFrom(path);
  state.machine = name;
  writeStateTo(path, state);
}

export function readState(): State {
  return readStateFrom(STATE_PATH);
}

export function writeState(state: State): void {
  writeStateTo(STATE_PATH, state);
}

export function saveInstallation(installation: Installation): void {
  saveInstallationTo(STATE_PATH, installation);
}
