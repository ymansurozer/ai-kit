import { hostname } from "os";

import { log } from "./log";
import { readMachineOverrideFrom, saveMachineOverrideTo, STATE_PATH } from "./state";

/**
 * Normalize a raw hostname into an overlay machine name: lowercased, with a
 * trailing `.local` suffix stripped (macOS reports names like `Yusufs-Mac.local`).
 * Pure — the only place hostname shape is decided.
 */
export function normalizeHostname(raw: string): string {
  return raw.toLowerCase().replace(/\.local$/, "");
}

export type MachineSource = "hostname" | "override";

export interface EffectiveMachine {
  name: string;
  source: MachineSource;
}

/**
 * Resolve the effective machine name for overlay selection: the stored override
 * if set, else the normalized OS hostname. `statePath` and `host` are test seams,
 * defaulting to the real state file and `os.hostname()`.
 */
export function resolveMachineFrom(statePath: string, host: string = hostname()): EffectiveMachine {
  const override = readMachineOverrideFrom(statePath);
  if (override !== undefined) {
    return { name: override, source: "override" };
  }
  return { name: normalizeHostname(host), source: "hostname" };
}

export interface ConfigMachineOptions {
  statePath?: string;
  host?: string;
}

/**
 * `ai-kit config machine [name]` (PRD behavior 23). With a name, store it as the
 * override and confirm; with no name, print the effective name and its source.
 */
export function configMachine(name?: string, options: ConfigMachineOptions = {}): void {
  const statePath = options.statePath ?? STATE_PATH;
  if (name) {
    saveMachineOverrideTo(statePath, name);
    log.success(`Machine name override set to "${name}"`);
    return;
  }
  const effective = resolveMachineFrom(statePath, options.host);
  log.info(`Machine name: ${effective.name} (source: ${effective.source})`);
}
