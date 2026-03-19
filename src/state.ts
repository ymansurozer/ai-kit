import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
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

export function readState(): State {
  if (!existsSync(STATE_PATH)) return { installations: [] };
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

export function writeState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export function saveInstallation(installation: Installation): void {
  const state = readState();

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

  writeState(state);
}
