import { describe, test, expect } from "bun:test";
import { join } from "path";

import { DESCRIPTORS, configRootFor, type TargetName } from "./descriptors";

const TARGETS: TargetName[] = ["claude", "codex", "pi", "opencode"];

describe("DESCRIPTORS", () => {
  test("includes all four targets keyed by name", () => {
    expect(Object.keys(DESCRIPTORS).toSorted()).toEqual(TARGETS.toSorted());
    for (const target of TARGETS) {
      expect(DESCRIPTORS[target].name).toBe(target);
    }
  });

  test("declares config roots relative to home", () => {
    expect(DESCRIPTORS.claude.configRoot).toEqual([".claude"]);
    expect(DESCRIPTORS.codex.configRoot).toEqual([".codex"]);
    expect(DESCRIPTORS.pi.configRoot).toEqual([".pi", "agent"]);
    expect(DESCRIPTORS.opencode.configRoot).toEqual([".config", "opencode"]);
  });

  test("declares MCP support with only Pi carved out", () => {
    expect(DESCRIPTORS.claude.supportsMcps).toBe(true);
    expect(DESCRIPTORS.codex.supportsMcps).toBe(true);
    expect(DESCRIPTORS.opencode.supportsMcps).toBe(true);
    expect(DESCRIPTORS.pi.supportsMcps).toBe(false);
  });

  test("declares curated well-known files", () => {
    expect(DESCRIPTORS.claude.curatedFiles).toEqual([
      "settings.json",
      "CLAUDE.md",
      "keybindings.json",
      "statusline-command.sh",
      "agents/",
      "hooks/",
      "output-styles/",
    ]);
    expect(DESCRIPTORS.codex.curatedFiles).toEqual(["config.toml", "AGENTS.md"]);
    expect(DESCRIPTORS.pi.curatedFiles).toEqual(["settings.json", "keybindings.json"]);
    expect(DESCRIPTORS.opencode.curatedFiles).toEqual(["opencode.json", "AGENTS.md"]);
  });

  test("declares MCP-managed destination files inside the config root", () => {
    expect(DESCRIPTORS.claude.mcpManagedFiles).toEqual([]);
    expect(DESCRIPTORS.codex.mcpManagedFiles).toEqual(["config.toml"]);
    expect(DESCRIPTORS.pi.mcpManagedFiles).toEqual([]);
    expect(DESCRIPTORS.opencode.mcpManagedFiles).toEqual(["opencode.json"]);
  });

  test("bans Claude's own skill-install output from the config tree", () => {
    expect(DESCRIPTORS.claude.bannedConfigPaths).toEqual(["skills"]);
    expect(DESCRIPTORS.codex.bannedConfigPaths).toEqual([]);
    expect(DESCRIPTORS.pi.bannedConfigPaths).toEqual([]);
    expect(DESCRIPTORS.opencode.bannedConfigPaths).toEqual([]);
  });
});

describe("configRootFor", () => {
  test("resolves the config root under the given home directory", () => {
    const home = "/home/tester";
    expect(configRootFor("claude", home)).toBe(join(home, ".claude"));
    expect(configRootFor("codex", home)).toBe(join(home, ".codex"));
    expect(configRootFor("pi", home)).toBe(join(home, ".pi", "agent"));
    expect(configRootFor("opencode", home)).toBe(join(home, ".config", "opencode"));
  });
});
