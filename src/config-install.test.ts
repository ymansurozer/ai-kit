import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { installConfigFiles, configInstall } from "./config-install";
import { readStateFrom, writeStateTo } from "./state";
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

  test("an old-format state entry (no configFiles map) behaves per the adoption rule", () => {
    writeConfig("claude/settings.json", "repo-version");
    const dest = join(configRootFor("claude", home), "settings.json");
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, "live-version");

    // Simulate a pre-slice-03 state file: an entry lacking configFiles entirely.
    writeStateTo(statePath, {
      installations: [
        { target: "claude", global: true, path: home, config: true, skills: [], mcps: [], installedAt: "2026-01-01" },
      ],
    });

    configInstall("claude", { home, configDir, statePath });
    // No recorded hash for the existing destination → adoption → skipped.
    expect(readFileSync(dest, "utf-8")).toBe("live-version");
  });
});
