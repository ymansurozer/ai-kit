import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { log } from "./log";
import { stripClaudeMcpEntries } from "./targets/claude";
import { stripCodexMcpSections } from "./targets/codex";
import { configRootFor, type TargetName } from "./targets/descriptors";
import { stripOpencodeMcpEntries } from "./targets/opencode";

/**
 * The skills directory a target installs into, per scope — the exact expression
 * each target installer uses (see the installers in `src/targets/`). Orphan pruning
 * deletes `join(dir, name)` for every skill name dropped since the last run.
 */
export function skillsDirFor(target: TargetName, global: boolean, cwd: string, home: string): string {
  switch (target) {
    case "claude":
      return global ? join(configRootFor("claude", home), "skills") : join(cwd, ".agents", "skills");
    case "codex":
    case "pi":
      return global ? join(home, ".agents", "skills") : join(cwd, ".agents", "skills");
    case "opencode":
      return global ? join(configRootFor("opencode", home), "skills") : join(cwd, ".opencode", "skills");
  }
}

/**
 * Delete the skill directories for `names` from the target's skills directory.
 * Only names the caller pulled from the recorded snapshot ever reach here, so a
 * hand-placed skill dir sitting alongside is never touched. Idempotent via
 * `force: true`: a name whose dir is already gone is a no-op.
 */
export function pruneSkills(target: TargetName, global: boolean, cwd: string, home: string, names: string[]): void {
  if (names.length === 0) {
    return;
  }
  const dir = skillsDirFor(target, global, cwd, home);
  for (const name of names) {
    rmSync(join(dir, name), { recursive: true, force: true });
    log.info(`Removed skill ${name} from ${dir}`);
  }
}

/** The MCP destination file and matching section-stripper for a target that
 * supports MCP config; `undefined` for Pi, which installs no MCPs. */
function mcpDestFor(
  target: TargetName,
  global: boolean,
  cwd: string,
  home: string,
): { path: string; strip: (content: string, names: string[]) => string } | undefined {
  switch (target) {
    case "claude":
      return { path: global ? join(home, ".claude.json") : join(cwd, ".mcp.json"), strip: stripClaudeMcpEntries };
    case "codex":
      return {
        path: global ? join(configRootFor("codex", home), "config.toml") : join(cwd, ".codex", "config.toml"),
        strip: stripCodexMcpSections,
      };
    case "opencode":
      return {
        path: global ? join(configRootFor("opencode", home), "opencode.json") : join(cwd, "opencode.json"),
        strip: stripOpencodeMcpEntries,
      };
    case "pi":
      return undefined;
  }
}

/**
 * Remove the named MCP entries from the target's MCP destination file, leaving
 * every other entry and all non-MCP content intact (the strippers only touch the
 * ai-kit-rendered sections). Missing destination file → nothing to do. Pi has no
 * MCP support, so its prune list is always empty.
 */
export function pruneMcps(target: TargetName, global: boolean, cwd: string, home: string, names: string[]): void {
  if (names.length === 0) {
    return;
  }
  const dest = mcpDestFor(target, global, cwd, home);
  if (!dest || !existsSync(dest.path)) {
    return;
  }
  const content = readFileSync(dest.path, "utf-8");
  const stripped = dest.strip(content, names);
  if (stripped !== content) {
    writeFileSync(dest.path, stripped);
    log.info(`Removed MCP(s) ${names.join(", ")} from ${dest.path}`);
  }
}
