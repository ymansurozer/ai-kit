import { existsSync } from "fs";
import { join } from "path";

import { readJsonFile } from "./json";
import { log } from "./log";
import { structuredKind } from "./structured";
import { DESCRIPTORS, type TargetName } from "./targets/descriptors";

/** Manifest file name, at the config-tree root (sibling of the per-target dirs). */
export const MACHINE_OWNED_FILE = "machine-owned.json";

/**
 * The declaration of which top-level keys each machine owns, resolved once per
 * config phase and then queried per file.
 */
export interface MachineOwnedKeys {
  /**
   * The top-level keys the machine owns in `relPath` under `target` — empty for
   * every file the manifest does not declare (and for every file at all when no
   * manifest exists, which keeps the feature fully inert).
   */
  ownedKeysFor(target: TargetName, relPath: string): string[];
}

/** True for a JSON object literal — the shape every manifest level must have. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Load `machine-owned.json` from a config-tree root — `dir` is the `config/`
 * folder itself, per the `*From(dir)` convention.
 *
 * Absence is the common case and means "no keys are machine-owned anywhere", so
 * every flow behaves exactly as it did before the feature existed. A manifest
 * that exists but cannot be read or parsed as a JSON object throws instead,
 * naming the file: the manifest is the only thing standing between a sync and
 * clobbering the machine's own values, so no caller may proceed on a guess about
 * its contents.
 *
 * Individual bad entries are not fatal — an unknown target, a file that is not
 * JSON/TOML (per-key ownership is meaningless for opaque bytes), or a value that
 * is not an array of strings is warned about by name and skipped, leaving its
 * valid siblings in force. That a declared file exists in the config tree is
 * deliberately NOT checked: the tree varies per machine overlay, so an entry with
 * no counterpart here is simply never asked for.
 */
export function loadMachineOwnedFrom(dir: string): MachineOwnedKeys {
  const path = join(dir, MACHINE_OWNED_FILE);
  const declared = new Map<string, string[]>();

  if (!existsSync(path)) {
    return { ownedKeysFor: () => [] };
  }

  const raw = readJsonFile(path, "it must map target → file → array of top-level key names");
  if (!isObject(raw)) {
    throw new Error(
      `Failed to read machine-owned manifest ${path}: expected an object mapping target → file → array of ` +
        `top-level key names`,
    );
  }

  for (const [target, files] of Object.entries(raw)) {
    if (!Object.hasOwn(DESCRIPTORS, target)) {
      log.warn(`Ignoring machine-owned entry for unknown target "${target}" in ${path}`);
      continue;
    }
    if (!isObject(files)) {
      log.warn(`Ignoring machine-owned entry "${target}" in ${path}: expected an object mapping file → keys`);
      continue;
    }
    for (const [relPath, keys] of Object.entries(files)) {
      if (structuredKind(relPath) === null) {
        log.warn(`Ignoring machine-owned entry "${target}/${relPath}" in ${path}: only JSON and TOML files have keys`);
        continue;
      }
      if (!isStringArray(keys)) {
        log.warn(`Ignoring machine-owned entry "${target}/${relPath}" in ${path}: expected an array of key names`);
        continue;
      }
      declared.set(`${target}/${relPath}`, keys);
    }
  }

  return {
    ownedKeysFor: (target, relPath) => declared.get(`${target}/${relPath}`) ?? [],
  };
}
