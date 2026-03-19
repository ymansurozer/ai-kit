import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const STATE_DIR = join(homedir(), ".ai-kit");
export const STATE_PATH = join(STATE_DIR, "state.json");

export interface Installation {
  target: string;
  global: boolean;
  path?: string;
  skills: string[];
  mcps: string[];
  installedAt: string;
}

export interface State {
  installations: Installation[];
}

export function readStateFrom(path: string): State {
  if (!existsSync(path)) return { installations: [] };
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeStateTo(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

export function saveInstallationTo(path: string, installation: Installation): void {
  const state = readStateFrom(path);

  const idx = state.installations.findIndex(
    (i) =>
      i.target === installation.target &&
      i.global === installation.global &&
      i.path === installation.path,
  );

  if (idx >= 0) {
    state.installations[idx] = installation;
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
