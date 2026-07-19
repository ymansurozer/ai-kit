import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { installConfigFiles, configInstall } from "./config-install";
import { readStateFrom, writeStateTo, saveMachineOverrideTo } from "./state";
import { configRootFor } from "./targets/descriptors";

describe("installConfigFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-install-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes files, creating parent directories, and records their hashes", () => {
    const outcome = installConfigFiles([{ relPath: "hooks/foo.sh", content: "echo hi" }], tmpDir);
    expect(outcome.installed).toEqual(["hooks/foo.sh"]);
    expect(outcome.skippedDrift).toEqual([]);
    expect(Object.keys(outcome.hashes)).toEqual(["hooks/foo.sh"]);
    expect(readFileSync(join(tmpDir, "hooks/foo.sh"), "utf-8")).toBe("echo hi");
  });

  test("overwrites a destination unchanged since the last install (hash matches)", () => {
    // Seed the destination with what ai-kit last wrote, and pass that hash.
    const first = installConfigFiles([{ relPath: "sub/keep.json", content: "v1" }], tmpDir);
    // Repo content changes; destination still equals what ai-kit wrote → overwrite.
    const second = installConfigFiles([{ relPath: "sub/keep.json", content: "v2" }], tmpDir, {
      recordedHashes: first.hashes,
    });
    expect(second.installed).toEqual(["sub/keep.json"]);
    expect(second.skippedDrift).toEqual([]);
    expect(readFileSync(join(tmpDir, "sub", "keep.json"), "utf-8")).toBe("v2");
  });

  test("skips a destination that drifted from the recorded hash", () => {
    const first = installConfigFiles([{ relPath: "sub/keep.json", content: "v1" }], tmpDir);
    // Someone edits the destination externally after ai-kit wrote it.
    writeFileSync(join(tmpDir, "sub", "keep.json"), "hand-edited");

    const second = installConfigFiles([{ relPath: "sub/keep.json", content: "v2" }], tmpDir, {
      recordedHashes: first.hashes,
    });
    expect(second.installed).toEqual([]);
    expect(second.skippedDrift).toEqual([{ relPath: "sub/keep.json", reason: "drifted" }]);
    expect(readFileSync(join(tmpDir, "sub", "keep.json"), "utf-8")).toBe("hand-edited");
  });

  test("skips a pre-existing destination ai-kit never wrote (unmanaged/adoption)", () => {
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "sub", "keep.json"), "pre-existing");

    const outcome = installConfigFiles([{ relPath: "sub/keep.json", content: "new" }], tmpDir);
    expect(outcome.installed).toEqual([]);
    expect(outcome.skippedDrift).toEqual([{ relPath: "sub/keep.json", reason: "unmanaged" }]);
    expect(readFileSync(join(tmpDir, "sub", "keep.json"), "utf-8")).toBe("pre-existing");
  });

  test("force overwrites an unmanaged destination and records its hash", () => {
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "sub", "keep.json"), "pre-existing");

    const outcome = installConfigFiles([{ relPath: "sub/keep.json", content: "forced" }], tmpDir, { force: true });
    expect(outcome.installed).toEqual(["sub/keep.json"]);
    expect(outcome.skippedDrift).toEqual([]);
    expect(Object.keys(outcome.hashes)).toEqual(["sub/keep.json"]);
    expect(readFileSync(join(tmpDir, "sub", "keep.json"), "utf-8")).toBe("forced");
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
    // Global config state is keyed under path: undefined — the same key `install
    // --global` uses — so a full install and a config-only install share one entry.
    // (undefined round-trips through JSON as an absent key.)
    expect(claude).toMatchObject({ target: "claude", global: true, config: true });
    expect(claude!.path).toBeUndefined();
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

  test(".gitkeep placeholders in the tree are never installed", () => {
    writeConfig("claude/.gitkeep", "");
    writeConfig("codex/.gitkeep", "");
    writeConfig("claude/settings.json", "{}");

    configInstall(undefined, { home, configDir, statePath });

    expect(existsSync(join(configRootFor("claude", home), "settings.json"))).toBe(true);
    expect(existsSync(join(configRootFor("claude", home), ".gitkeep"))).toBe(false);
    expect(existsSync(join(configRootFor("codex", home), ".gitkeep"))).toBe(false);
  });

  test("a binary file installs byte-for-byte, skips ${VAR} expansion, and re-installs without drift", () => {
    // Invalid UTF-8 plus a ${VAR}-looking byte sequence that must NOT be expanded.
    const bytes = Buffer.concat([Buffer.from([0x00, 0xff, 0x80]), Buffer.from("${HOME}"), Buffer.from([0xfe, 0x00])]);
    const full = join(configDir, "claude/hooks/done.aac");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, bytes);

    configInstall("claude", { home, configDir, statePath, env: { HOME: "/somewhere" } });
    const dest = join(configRootFor("claude", home), "hooks/done.aac");
    expect(readFileSync(dest)).toEqual(bytes);

    // Second run: recorded hash matches the raw bytes → overwritten freely, no drift skip.
    configInstall("claude", { home, configDir, statePath, env: { HOME: "/somewhere" } });
    expect(readFileSync(dest)).toEqual(bytes);
    const state = readStateFrom(statePath);
    expect(state.installations[0].configFiles!["hooks/done.aac"]).toBeDefined();
  });

  test("an executable hook installs executable on a fresh machine", () => {
    const full = join(configDir, "claude/hooks/notify.sh");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "#!/bin/sh\n", { mode: 0o755 });

    configInstall("claude", { home, configDir, statePath });

    const dest = join(configRootFor("claude", home), "hooks/notify.sh");
    expect(statSync(dest).mode & 0o777).toBe(0o755);
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

  test("fresh destination is written and its hash recorded in state", () => {
    writeConfig("claude/settings.json", "repo-v1");
    configInstall("claude", { home, configDir, statePath });

    const dest = join(configRootFor("claude", home), "settings.json");
    expect(readFileSync(dest, "utf-8")).toBe("repo-v1");
    const inst = readStateFrom(statePath).installations.find((i) => i.target === "claude");
    expect(inst!.configFiles).toBeDefined();
    expect(Object.keys(inst!.configFiles!)).toEqual(["settings.json"]);
  });

  test("a destination unmodified since the last install is overwritten silently", () => {
    writeConfig("claude/settings.json", "repo-v1");
    configInstall("claude", { home, configDir, statePath });
    const dest = join(configRootFor("claude", home), "settings.json");
    expect(readFileSync(dest, "utf-8")).toBe("repo-v1");

    // Repo content changes; destination still equals what ai-kit wrote → updated.
    writeConfig("claude/settings.json", "repo-v2");
    configInstall("claude", { home, configDir, statePath });
    expect(readFileSync(dest, "utf-8")).toBe("repo-v2");
  });

  test("a destination modified externally since the last install is skipped", () => {
    writeConfig("claude/settings.json", "repo-v1");
    configInstall("claude", { home, configDir, statePath });
    const dest = join(configRootFor("claude", home), "settings.json");

    // Harness (or a human) rewrites the destination out from under ai-kit.
    writeFileSync(dest, "hand-edited");
    writeConfig("claude/settings.json", "repo-v2");
    configInstall("claude", { home, configDir, statePath });

    expect(readFileSync(dest, "utf-8")).toBe("hand-edited");
  });

  test("--force overwrites a pre-existing (adopted) destination and records its hash", () => {
    writeConfig("claude/settings.json", "repo-version");
    const dest = join(configRootFor("claude", home), "settings.json");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "live-version");

    // Without force, adoption rule skips it.
    configInstall("claude", { home, configDir, statePath });
    expect(readFileSync(dest, "utf-8")).toBe("live-version");

    // With force, the repo version wins and the hash is recorded.
    configInstall("claude", { home, configDir, statePath, force: true });
    expect(readFileSync(dest, "utf-8")).toBe("repo-version");
    const inst = readStateFrom(statePath).installations.find((i) => i.target === "claude");
    expect(Object.keys(inst!.configFiles ?? {})).toEqual(["settings.json"]);
  });

  test("two consecutive installs with no external change report zero drift (idempotent)", () => {
    writeConfig("claude/settings.json", "repo-v1");
    configInstall("claude", { home, configDir, statePath });
    const dest = join(configRootFor("claude", home), "settings.json");

    // Second run: nothing changed externally, so it overwrites without drift.
    configInstall("claude", { home, configDir, statePath });
    expect(readFileSync(dest, "utf-8")).toBe("repo-v1");
  });

  test("expands ${VAR} in content from the provided env; destination has no placeholder", () => {
    writeConfig("claude/settings.json", '{"token":"${TEST_TOKEN}"}');
    configInstall("claude", { home, configDir, statePath, env: { TEST_TOKEN: "s3cr3t" } });

    const dest = join(configRootFor("claude", home), "settings.json");
    expect(readFileSync(dest, "utf-8")).toBe('{"token":"s3cr3t"}');
  });

  test("skips a file with an unset var (naming it) while siblings install; not a hard failure", () => {
    writeConfig("claude/settings.json", '{"token":"${MISSING_TOKEN}"}');
    writeConfig("claude/CLAUDE.md", "# no placeholders");

    expect(() => configInstall("claude", { home, configDir, statePath, env: {} })).not.toThrow();

    const root = configRootFor("claude", home);
    // Sibling with no placeholder still installs.
    expect(readFileSync(join(root, "CLAUDE.md"), "utf-8")).toBe("# no placeholders");
    // File with the unset var is not written.
    expect(existsSync(join(root, "settings.json"))).toBe(false);
    // Its hash is not recorded either, since it was never written.
    const inst = readStateFrom(statePath).installations.find((i) => i.target === "claude");
    expect(Object.keys(inst!.configFiles ?? {})).toEqual(["CLAUDE.md"]);
  });

  test("re-running install with the same env reports no drift (hash taken post-expansion)", () => {
    writeConfig("claude/settings.json", '{"token":"${TEST_TOKEN}"}');
    const env = { TEST_TOKEN: "value1" };
    configInstall("claude", { home, configDir, statePath, env });
    const dest = join(configRootFor("claude", home), "settings.json");
    expect(readFileSync(dest, "utf-8")).toBe('{"token":"value1"}');

    // Second run, same env: the destination equals the post-expansion hash → overwrite, no drift.
    configInstall("claude", { home, configDir, statePath, env });
    expect(readFileSync(dest, "utf-8")).toBe('{"token":"value1"}');
  });

  test("installs overlay-merged content for the effective machine (worked example)", () => {
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", env: { A: "1", B: "2" } }));
    writeConfig("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet", env: { B: "9" } }));

    configInstall("claude", { home, configDir, statePath, machine: "laptop" });

    const dest = join(configRootFor("claude", home), "settings.json");
    expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({ model: "sonnet", env: { A: "1", B: "9" } });
  });

  test("an overlay for a different machine does not affect the install", () => {
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus" }));
    writeConfig("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    configInstall("claude", { home, configDir, statePath, machine: "desktop" });

    const dest = join(configRootFor("claude", home), "settings.json");
    expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({ model: "opus" });
  });

  test("a stored machine override drives overlay resolution when no machine is injected", () => {
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus" }));
    writeConfig("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));
    saveMachineOverrideTo(statePath, "laptop");

    configInstall("claude", { home, configDir, statePath });

    const dest = join(configRootFor("claude", home), "settings.json");
    expect(JSON.parse(readFileSync(dest, "utf-8"))).toEqual({ model: "sonnet" });
  });

  test("merged overlay content installs idempotently (no drift on re-run)", () => {
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", env: { A: "1" } }));
    writeConfig("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    configInstall("claude", { home, configDir, statePath, machine: "laptop" });
    const dest = join(configRootFor("claude", home), "settings.json");
    const first = readFileSync(dest, "utf-8");

    // Second run with no external change: the merged content hashes identically,
    // so the destination is overwritten with the same bytes and reports no drift.
    configInstall("claude", { home, configDir, statePath, machine: "laptop" });
    expect(readFileSync(dest, "utf-8")).toBe(first);
  });

  test("an old-format state entry (no configFiles map) behaves per the adoption rule", () => {
    writeConfig("claude/settings.json", "repo-version");
    const dest = join(configRootFor("claude", home), "settings.json");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "live-version");

    // Simulate a pre-slice-03 state file: an entry lacking configFiles entirely.
    writeStateTo(statePath, {
      installations: [
        {
          target: "claude",
          global: true,
          path: undefined,
          config: true,
          skills: [],
          mcps: [],
          installedAt: "2026-01-01",
        },
      ],
    });

    configInstall("claude", { home, configDir, statePath });
    // No recorded hash for the existing destination → adoption → skipped.
    expect(readFileSync(dest, "utf-8")).toBe("live-version");
  });
});

describe("configInstall MCP re-merge on shared destination files (behavior 10)", () => {
  let tmpDir: string;
  let home: string;
  let configDir: string;
  let statePath: string;

  const mcp = {
    name: "playwright",
    description: "browser automation",
    config: { command: "npx", args: ["-y", "@test/playwright"] },
    path: "/repo/mcps/playwright.json",
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-remerge-"));
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

  // Represent a machine that already ran a full `install codex --global`: its entry
  // records the "all" MCP selection (mcps omitted → undefined). The MCP list is
  // injected via the seam so the test never reads the real repo mcps/ tree.
  function seedPriorFullInstall(): void {
    writeStateTo(statePath, {
      installations: [{ target: "codex", global: true, config: true, installedAt: "2026-01-01" }],
    });
  }

  test("re-merges MCP sections that rewriting config.toml would have dropped, keeping both", () => {
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    seedPriorFullInstall();

    configInstall("codex", { home, configDir, statePath, mcps: [mcp] });

    const dest = join(configRootFor("codex", home), "config.toml");
    const content = readFileSync(dest, "utf-8");
    // The repo config AND the MCP section both survive.
    expect(content).toContain('model = "gpt-5-codex"');
    expect(content).toContain("[mcp_servers.playwright]");
  });

  test("an immediate second install reports zero drift: content is byte-stable and still holds both", () => {
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    seedPriorFullInstall();

    configInstall("codex", { home, configDir, statePath, mcps: [mcp] });
    const dest = join(configRootFor("codex", home), "config.toml");
    const first = readFileSync(dest, "utf-8");

    // Second run: the recorded hash covers the post-merge file, so it overwrites
    // without drift, rewrites the repo config, and re-merges the MCP section — the
    // final bytes are identical to the first run.
    configInstall("codex", { home, configDir, statePath, mcps: [mcp] });
    const second = readFileSync(dest, "utf-8");

    expect(second).toBe(first);
    expect(second).toContain('model = "gpt-5-codex"');
    expect(second).toContain("[mcp_servers.playwright]");
  });

  test("a config-only machine with no prior MCP install gets no injected MCP sections", () => {
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    // No prior installation record → nothing to restore.

    configInstall("codex", { home, configDir, statePath, mcps: [mcp] });

    const dest = join(configRootFor("codex", home), "config.toml");
    const content = readFileSync(dest, "utf-8");
    expect(content).toContain('model = "gpt-5-codex"');
    expect(content).not.toContain("[mcp_servers.playwright]");
  });
});
