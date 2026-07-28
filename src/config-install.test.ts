import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createHash } from "crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { installConfigFiles, configInstall, type ConfigInstallOptions } from "./config-install";
import { stripOwnedKeys } from "./owned-keys";
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

  test("a shell script's ${var} syntax is never expanded or treated as a missing placeholder", () => {
    // A statusline-style script with internal runtime variables, unset at install.
    const script = '#!/bin/bash\nout="${model_family} ${effort_abbr}"\necho "$out"\n';
    writeConfig("claude/statusline.sh", script);

    configInstall("claude", { home, configDir, statePath, env: { model_family: "SHOULD-NOT-APPEAR" } });

    const dest = join(configRootFor("claude", home), "statusline.sh");
    expect(readFileSync(dest, "utf-8")).toBe(script);
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
    writeConfig("claude/skills/foo.md", "banned");
    expect(() => configInstall("claude", { home, configDir, statePath })).toThrow(/skills/);
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

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("configInstall with machine-owned keys", () => {
  let tmpDir: string;
  let home: string;
  let configDir: string;
  let statePath: string;

  /** Injected via the seam so the mcp-managed cases never read the repo mcps/ tree. */
  const remergeMcp = {
    name: "playwright",
    description: "browser automation",
    config: { command: "npx", args: ["-y", "@test/playwright"] },
    path: "/repo/mcps/playwright.json",
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-owned-"));
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

  /** Write the config tree's machine-owned manifest; `content` may be raw text to
   * cover the malformed case. */
  function writeManifest(content: unknown): void {
    const text = typeof content === "string" ? content : JSON.stringify(content);
    writeFileSync(join(configDir, "machine-owned.json"), text);
  }

  function destPath(target: "claude" | "codex", relPath: string): string {
    return join(configRootFor(target, home), relPath);
  }

  /** Write a destination file as if the harness (or a human) had rewritten it. */
  function writeDest(target: "claude" | "codex", relPath: string, content: string): void {
    const dest = destPath(target, relPath);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content);
  }

  function readDest(target: "claude" | "codex", relPath: string): string {
    return readFileSync(destPath(target, relPath), "utf-8");
  }

  function recordedHash(target: string, relPath: string): string | undefined {
    return readStateFrom(statePath).installations.find((i) => i.target === target)?.configFiles?.[relPath];
  }

  /** A machine that already ran a full `install codex --global`: only such a
   * machine gets its MCP sections re-merged after the config write. */
  function seedPriorFullInstall(): void {
    writeStateTo(statePath, {
      installations: [{ target: "codex", global: true, config: true, installedAt: "2026-01-01" }],
    });
  }

  /** Run an install with `log` captured, returning everything it printed. */
  function installCapturingOutput(target: string, extra: Partial<ConfigInstallOptions> = {}): string {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    try {
      configInstall(target, { home, configDir, statePath, mcps: [], ...extra });
      return spy.mock.calls.map((c) => String(c[0])).join("\n");
    } finally {
      spy.mockRestore();
    }
  }

  test("a machine-owned key churned at the destination no longer blocks the file from syncing", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });

    // The harness switches the model out from under ai-kit; the repo moves on too.
    writeDest("claude", "settings.json", JSON.stringify({ model: "sonnet", theme: "dark" }));
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath });

    // Written, not drift-skipped: the machine keeps its model, everything else refreshes.
    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ model: "sonnet", theme: "light" });
  });

  test("a non-owned key edited in the same file still trips the drift guard", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });

    const handEdited = JSON.stringify({ model: "opus", theme: "hand-edited" });
    writeDest("claude", "settings.json", handEdited);
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath });

    expect(readDest("claude", "settings.json")).toBe(handEdited);
  });

  test("a destination that does not exist is seeded with the repo content as-is", () => {
    const repo = JSON.stringify({ model: "opus", theme: "dark" });
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", repo);

    configInstall("claude", { home, configDir, statePath });

    expect(readDest("claude", "settings.json")).toBe(repo);
  });

  test("a destination lacking an owned key the repo has does not get it back", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });

    // The repo later gains a default for the owned key: it seeds fresh machines only.
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath });

    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ theme: "light" });
  });

  test("--force resets non-owned content to the repo's but leaves owned keys with the machine", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });

    writeDest("claude", "settings.json", JSON.stringify({ model: "sonnet", theme: "hand-edited", extra: "local" }));
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath, force: true });

    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ model: "sonnet", theme: "light" });
  });

  test("a legacy raw whole-file hash still matches an untouched destination and is re-recorded stripped", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    const lastWritten = JSON.stringify({ model: "opus", theme: "dark" });
    writeDest("claude", "settings.json", lastWritten);
    // A machine that last installed before this feature: state holds the raw hash.
    writeStateTo(statePath, {
      installations: [
        {
          target: "claude",
          global: true,
          path: undefined,
          config: true,
          skills: [],
          mcps: [],
          configFiles: { "settings.json": sha256(lastWritten) },
          installedAt: "2026-01-01",
        },
      ],
    });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));

    configInstall("claude", { home, configDir, statePath });

    const written = readDest("claude", "settings.json");
    expect(JSON.parse(written)).toEqual({ model: "opus", theme: "light" });
    const recorded = recordedHash("claude", "settings.json");
    expect(recorded).toBe(sha256(stripOwnedKeys(written, ["model"], "json", "settings.json")));
    expect(recorded).not.toBe(sha256(written));
  });

  test("a destination that cannot be parsed is skipped, named with the parse problem, and never overwritten", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });

    const corrupt = '{ "model": "sonnet", ';
    writeDest("claude", "settings.json", corrupt);
    const output = installCapturingOutput("claude");

    expect(readDest("claude", "settings.json")).toBe(corrupt);
    expect(output).toContain("Skipped config settings.json");
    expect(output).toContain("Failed to parse JSON file");
    expect(output).toContain(destPath("claude", "settings.json"));

    // --force cannot help: the machine's owned keys are unreadable, so it stays put.
    configInstall("claude", { home, configDir, statePath, force: true });
    expect(readDest("claude", "settings.json")).toBe(corrupt);
  });

  test("installConfigFiles reports a corrupt destination as its own skip reason with the parse detail", () => {
    const root = join(tmpDir, "root");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "settings.json"), "{ oops");

    const outcome = installConfigFiles([{ relPath: "settings.json", content: "{}" }], root, {
      recordedHashes: { "settings.json": "whatever" },
      ownedKeysFor: () => ["model"],
    });

    expect(outcome.installed).toEqual([]);
    expect(outcome.skippedDrift).toHaveLength(1);
    expect(outcome.skippedDrift[0].reason).toBe("corrupt");
    expect(outcome.skippedDrift[0].detail).toContain(join(root, "settings.json"));
  });

  test("an invalid manifest entry warns and leaves its valid siblings in force", () => {
    writeManifest({ nonsense: { "settings.json": ["model"] }, claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    const output = installCapturingOutput("claude");
    expect(output).toContain('unknown target "nonsense"');

    // The valid claude entry still protects the model across a re-install.
    writeDest("claude", "settings.json", JSON.stringify({ model: "sonnet", theme: "dark" }));
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath });
    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ model: "sonnet", theme: "light" });
  });

  test("a malformed manifest aborts the config phase naming it, before anything is written", () => {
    writeManifest('{ "claude": ');
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus" }));

    expect(() => configInstall("claude", { home, configDir, statePath })).toThrow(/machine-owned\.json/);
    expect(existsSync(destPath("claude", "settings.json"))).toBe(false);
  });

  test("TOML behaves identically: churn in an owned key syncs the rest of the file", () => {
    writeManifest({ codex: { "config.toml": ["model"] } });
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\napproval = "on-request"\n');
    configInstall("codex", { home, configDir, statePath, mcps: [] });

    writeDest("codex", "config.toml", 'model = "gpt-5.1-codex-max"\napproval = "on-request"\n');
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\napproval = "never"\n');
    configInstall("codex", { home, configDir, statePath, mcps: [] });

    const written = readDest("codex", "config.toml");
    expect(written).toContain('model = "gpt-5.1-codex-max"');
    expect(written).toContain('approval = "never"');
  });

  test("an overlay's value for an owned key seeds a fresh machine but never beats an existing destination", () => {
    writeManifest({ claude: { "settings.json": ["model"] } });
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    writeConfig("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    configInstall("claude", { home, configDir, statePath, machine: "laptop" });
    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ model: "sonnet", theme: "dark" });

    // Machine switches models; the overlay must not pull it back on the next sync.
    writeDest("claude", "settings.json", JSON.stringify({ model: "haiku", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath, machine: "laptop" });
    expect(JSON.parse(readDest("claude", "settings.json"))).toEqual({ model: "haiku", theme: "dark" });
  });

  test("an mcp-managed file with owned keys records its post-merge hash stripped, so a re-install sees no drift", () => {
    // Codex's config.toml is the file that is both: ai-kit writes the repo config,
    // its own MCP merge appends server sections, and Codex writes trust entries
    // into `projects`. Recording a raw post-merge hash here would make the next
    // sync's stripped comparison fail on ai-kit's own merge.
    writeManifest({ codex: { "config.toml": ["projects"] } });
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    seedPriorFullInstall();

    configInstall("codex", { home, configDir, statePath, mcps: [remergeMcp] });
    const afterFirst = readDest("codex", "config.toml");
    expect(afterFirst).toContain("[mcp_servers.playwright]");
    expect(recordedHash("codex", "config.toml")).toBe(
      sha256(stripOwnedKeys(afterFirst, ["projects"], "toml", "config.toml")),
    );

    const output = installCapturingOutput("codex", { mcps: [remergeMcp] });
    expect(output).not.toContain("Skipped config");
    const afterSecond = readDest("codex", "config.toml");
    expect(afterSecond).toContain('model = "gpt-5-codex"');
    expect(afterSecond).toContain("[mcp_servers.playwright]");
  });

  test("a trust entry Codex writes into an owned key survives the next install, MCP sections intact", () => {
    writeManifest({ codex: { "config.toml": ["projects"] } });
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    seedPriorFullInstall();

    configInstall("codex", { home, configDir, statePath, mcps: [remergeMcp] });

    // Codex trusts a new directory, appending to the key the machine owns — the
    // churn this feature exists for, on the file the MCP merge also touches.
    writeDest(
      "codex",
      "config.toml",
      readDest("codex", "config.toml") + '\n[projects."/tmp/repo"]\ntrust_level = "trusted"\n',
    );
    writeConfig("codex/config.toml", 'model = "gpt-5.1-codex-max"\n');
    configInstall("codex", { home, configDir, statePath, mcps: [remergeMcp] });

    const written = readDest("codex", "config.toml");
    // The repo update lands (no drift skip), the machine keeps its trust entry,
    // and the MCP sections the config write dropped are back.
    expect(written).toContain('model = "gpt-5.1-codex-max"');
    expect(written).toContain('[projects."/tmp/repo"]');
    expect(written).toContain('trust_level = "trusted"');
    expect(written).toContain("[mcp_servers.playwright]");
  });

  test("with no manifest, the recorded hash is the raw file hash and any edit is drift (regression guard)", () => {
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "dark" }));
    configInstall("claude", { home, configDir, statePath });
    expect(recordedHash("claude", "settings.json")).toBe(sha256(readDest("claude", "settings.json")));

    // Without a declaration, a model switch is drift exactly as it always was.
    const handEdited = JSON.stringify({ model: "sonnet", theme: "dark" });
    writeDest("claude", "settings.json", handEdited);
    writeConfig("claude/settings.json", JSON.stringify({ model: "opus", theme: "light" }));
    configInstall("claude", { home, configDir, statePath });
    expect(readDest("claude", "settings.json")).toBe(handEdited);
  });
});
