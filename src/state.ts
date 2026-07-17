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
  installedAt: string;
}

export interface State {
  installations: Installation[];
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
    };
  } else {
    state.installations.push(installation);
  }

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
