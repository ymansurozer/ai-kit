import { existsSync } from "fs";
import { readState } from "./state";
import { install } from "./install";
import { log } from "./log";

export function sync(): void {
  const state = readState();

  if (state.installations.length === 0) {
    log.warn("No tracked installations. Run `ai-kit install <target>` first.");
    return;
  }

  log.heading("Syncing all tracked installations");

  for (const inst of state.installations) {
    const label = inst.global
      ? `${inst.target} (global)`
      : `${inst.target} → ${inst.path}`;

    if (!inst.global && inst.path && !existsSync(inst.path)) {
      log.warn(`Skipping ${label} (directory not found)`);
      continue;
    }

    log.info(`Syncing: ${label}`);

    install(inst.target, {
      global: inst.global,
      cwd: inst.path,
    });
  }

  log.success("Sync complete");
}
