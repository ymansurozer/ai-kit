import { join } from "path";

export type TargetName = "claude" | "codex" | "pi" | "opencode";

export interface TargetDescriptor {
  /** Target identifier, matching the key in the DESCRIPTORS table. */
  name: TargetName;
  /** Config root path segments, relative to the home directory. */
  configRoot: string[];
  /**
   * Well-known config files/directories relative to the config root, used by
   * later slices for capture. A trailing "/" marks a directory.
   */
  curatedFiles: string[];
  /**
   * Destination files (relative to the config root) that the MCP installer
   * also writes. Claude's global MCP dest (~/.claude.json) lies outside the
   * config root by design and is therefore absent here.
   */
  mcpManagedFiles: string[];
  /** Whether the target supports MCP installation. */
  supportsMcps: boolean;
  /**
   * Config-tree paths (relative to the config root) that must never be shipped
   * as config — e.g. ai-kit's own skill-install output.
   */
  bannedConfigPaths: string[];
}

export const DESCRIPTORS: Record<TargetName, TargetDescriptor> = {
  claude: {
    name: "claude",
    configRoot: [".claude"],
    curatedFiles: [
      "settings.json",
      "CLAUDE.md",
      "keybindings.json",
      "statusline-command.sh",
      "agents/",
      "hooks/",
      "output-styles/",
    ],
    mcpManagedFiles: [],
    supportsMcps: true,
    bannedConfigPaths: ["skills"],
  },
  codex: {
    name: "codex",
    configRoot: [".codex"],
    curatedFiles: ["config.toml", "AGENTS.md"],
    mcpManagedFiles: ["config.toml"],
    supportsMcps: true,
    bannedConfigPaths: [],
  },
  pi: {
    name: "pi",
    configRoot: [".pi", "agent"],
    curatedFiles: ["settings.json", "keybindings.json"],
    mcpManagedFiles: [],
    supportsMcps: false,
    bannedConfigPaths: [],
  },
  opencode: {
    name: "opencode",
    configRoot: [".config", "opencode"],
    curatedFiles: ["opencode.json", "AGENTS.md"],
    mcpManagedFiles: ["opencode.json"],
    supportsMcps: true,
    bannedConfigPaths: [],
  },
};

/** Absolute config-root path for a target under the given home directory. */
export function configRootFor(target: TargetName, home: string): string {
  return join(home, ...DESCRIPTORS[target].configRoot);
}
