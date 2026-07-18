import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { installConfigFiles, configInstall } from "./config-install";
import { readStateFrom } from "./state";
import { configRootFor } from "./targets/descriptors";

describe("installConfigFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-install-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes files, creating parent directories", () => {
    const outcome = installConfigFiles([{ relPath: "hooks/foo.sh", content: "echo hi" }], tmpDir);
    expect(outcome.installed).toEqual(["hooks/foo.sh"]);
    expect(outcome.skippedExisting).toEqual([]);
    expect(readFileSync(join(tmpDir, "hooks/foo.sh"), "utf-8")).toBe("echo hi");
  });

  test("skips an existing destination without overwriting", () => {
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "sub", "keep.json"), "original");

    const outcome = installConfigFiles([{ relPath: "sub/keep.json", content: "new" }], tmpDir);
    expect(outcome.installed).toEqual([]);
    expect(outcome.skippedExisting).toEqual(["sub/keep.json"]);
    expect(readFileSync(join(tmpDir, "sub", "keep.json"), "utf-8")).toBe("original");
  });
});

describe("configInstall", () => {
  let tmpDir: string;
  let home: string;
  let configDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-cmd-"));
    home = join(tmpDir, "home");
    configDir = join(tmpDir, "config");
    statePath = join(tmpDir, "state.json");
    mkdirSync(home, { recursive: true });
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(relPath: string, content: string): void {
    const full = join(configDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  test("installs files under each target's config root and records state", () => {
    writeConfig("claude/settings.json", "{}");
    writeConfig("codex/AGENTS.md", "# codex");

    configInstall(undefined, { home, configDir, statePath });

    expect(existsSync(join(configRootFor("claude", home), "settings.json"))).toBe(true);
    expect(existsSync(join(configRootFor("codex", home), "AGENTS.md"))).toBe(true);

    const state = readStateFrom(statePath);
    const claude = state.installations.find((i) => i.target === "claude");
    expect(claude).toMatchObject({ target: "claude", global: true, path: home, config: true });
    // Fresh config-only entries record explicit empty selections (not undefined).
    expect(claude!.skills).toEqual([]);
    expect(claude!.mcps).toEqual([]);
  });

  test("config install <target> touches only that target's files", () => {
    writeConfig("claude/settings.json", "{}");
    writeConfig("codex/AGENTS.md", "# codex");

    configInstall("claude", { home, configDir, statePath });

    expect(existsSync(join(configRootFor("claude", home), "settings.json"))).toBe(true);
    expect(existsSync(join(configRootFor("codex", home), "AGENTS.md"))).toBe(false);

    const state = readStateFrom(statePath);
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].target).toBe("claude");
  });

  test("unknown target throws the unknown-target error listing valid targets", () => {
    expect(() => configInstall("nonsense", { home, configDir, statePath })).toThrow(/Unknown target: nonsense/);
  });

  test("empty tree is a graceful no-op with no state written", () => {
    configInstall(undefined, { home, configDir, statePath });
    expect(existsSync(statePath)).toBe(false);
  });

  test("a file removed from the tree leaves the previously installed destination in place (behavior 12)", () => {
    writeConfig("claude/settings.json", "first");
    configInstall("claude", { home, configDir, statePath });
    const dest = join(configRootFor("claude", home), "settings.json");
    expect(readFileSync(dest, "utf-8")).toBe("first");

    rmSync(join(configDir, "claude", "settings.json"));
    configInstall("claude", { home, configDir, statePath });

    // Destination is neither rewritten nor deleted.
    expect(readFileSync(dest, "utf-8")).toBe("first");
  });

  test("an existing destination is left untouched and reported as skipped", () => {
    writeConfig("claude/settings.json", "repo-version");
    const dest = join(configRootFor("claude", home), "settings.json");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "live-version");

    configInstall("claude", { home, configDir, statePath });
    expect(readFileSync(dest, "utf-8")).toBe("live-version");
  });

  test("a banned config path aborts with an explanatory error", () => {
    writeConfig("claude/commands/foo.md", "banned");
    expect(() => configInstall("claude", { home, configDir, statePath })).toThrow(/commands/);
  });
});
