import { existsSync } from "fs";

import { install } from "./install";
import { log } from "./log";
import { readState } from "./state";

/** Re-install every tracked installation. Returns false when any install was partial. */
export function sync(): boolean {
  const state = readState();

  if (state.installations.length === 0) {
    log.warn("No tracked installations. Run `ai-kit install <target>` first.");
    return true;
  }

  let complete = true;

  log.heading("Syncing all tracked installations");

  for (const inst of state.installations) {
    const label = inst.global ? `${inst.target} (global)` : `${inst.target} → ${inst.path}`;

    if (!inst.global && inst.path && !existsSync(inst.path)) {
      log.warn(`Skipping ${label} (directory not found)`);
      continue;
    }

    log.info(`Syncing: ${label}`);

    const installed = install(inst.target, {
      global: inst.global,
      cwd: inst.path,
      skills: inst.skills,
      mcps: inst.mcps,
    });
    complete = installed && complete;
  }

  if (!complete) {
    log.warn("Sync finished with MCPs held back until their setup succeeds");
    return false;
  }
  log.success("Sync complete");
  return true;
}
