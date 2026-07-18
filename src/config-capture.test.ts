import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { configCapture } from "./config-capture";
import { configRootFor } from "./targets/descriptors";

describe("configCapture", () => {
  let tmpDir: string;
  let home: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-capture-"));
    home = join(tmpDir, "home");
    configDir = join(tmpDir, "config");
    mkdirSync(home, { recursive: true });
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a file under a target's machine config root (the "live machine"). */
  function writeMachine(target: string, relPath: string, content: string): void {
    const full = join(configRootFor(target as never, home), relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  /** Write a file into the repo BASE config tree (an already-tracked file). */
  function writeTracked(target: string, relPath: string, content: string): void {
    const full = join(configDir, target, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function baseRead(target: string, relPath: string): string {
    return readFileSync(join(configDir, target, relPath), "utf-8");
  }

  function baseExists(target: string, relPath: string): boolean {
    return existsSync(join(configDir, target, relPath));
  }

  test("no-arg capture copies exactly tracked ∪ curated into the base tree; junk is untouched", () => {
    // Curated well-known files present on the machine.
    writeMachine("claude", "settings.json", '{"model":"opus"}');
    writeMachine("claude", "CLAUDE.md", "# claude");
    // Non-curated runtime junk on the machine.
    writeMachine("claude", "history.jsonl", "line1\n");
    writeMachine("claude", "projects/foo.json", "{}");
    // A repo tree already tracking one non-curated file that exists on the machine.
    writeMachine("claude", "custom.txt", "live-custom");
    writeTracked("claude", "custom.txt", "old-custom");

    configCapture("claude", { home, configDir });

    // Curated files captured.
    expect(baseRead("claude", "settings.json")).toBe('{"model":"opus"}');
    expect(baseRead("claude", "CLAUDE.md")).toBe("# claude");
    // Tracked non-curated file refreshed from the machine.
    expect(baseRead("claude", "custom.txt")).toBe("live-custom");
    // Junk never enters the base tree.
    expect(baseExists("claude", "history.jsonl")).toBe(false);
    expect(baseExists("claude", "projects/foo.json")).toBe(false);
    // Junk on the machine is left in place.
    expect(readFileSync(join(configRootFor("claude", home), "history.jsonl"), "utf-8")).toBe("line1\n");
  });

  test("capture <target> touches only that target's subtree", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("codex", "config.toml", 'model = "gpt-5"\n');

    configCapture("claude", { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    expect(existsSync(join(configDir, "codex"))).toBe(false);
  });

  test("no-arg capture visits every target", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("codex", "config.toml", 'model = "gpt-5"\n');

    configCapture(undefined, { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    expect(baseExists("codex", "config.toml")).toBe(true);
  });

  test("--file starts tracking an arbitrary non-curated file; a later no-arg capture refreshes it", () => {
    writeMachine("claude", "extras/notes.md", "v1");

    configCapture("claude", { home, configDir, file: "extras/notes.md" });
    expect(baseRead("claude", "extras/notes.md")).toBe("v1");

    // Now tracked: a subsequent no-arg capture refreshes it from the machine.
    writeMachine("claude", "extras/notes.md", "v2");
    configCapture("claude", { home, configDir });
    expect(baseRead("claude", "extras/notes.md")).toBe("v2");
  });

  test("--file requires an explicit target", () => {
    expect(() => configCapture(undefined, { home, configDir, file: "settings.json" })).toThrow(
      /--file requires an explicit target/,
    );
    expect(() => configCapture("all", { home, configDir, file: "settings.json" })).toThrow(
      /--file requires an explicit target/,
    );
  });

  test("a curated directory captures recursively", () => {
    writeMachine("claude", "hooks/pre.sh", "echo pre");
    writeMachine("claude", "hooks/nested/post.sh", "echo post");

    configCapture("claude", { home, configDir });

    expect(baseRead("claude", "hooks/pre.sh")).toBe("echo pre");
    expect(baseRead("claude", "hooks/nested/post.sh")).toBe("echo post");
  });

  test("implicit capture never grabs a banned path (claude commands/)", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("claude", "commands/foo.md", "ai-kit output");
    // Even a base tree that tracks it (shouldn't happen, but capture reads raw).
    writeTracked("claude", "commands/foo.md", "stale");

    configCapture("claude", { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    // The tracked banned path is neither refreshed nor newly grabbed.
    expect(baseRead("claude", "commands/foo.md")).toBe("stale");
  });

  test("--file inside a banned path errors with the explanation", () => {
    writeMachine("claude", "commands/foo.md", "ai-kit output");
    expect(() => configCapture("claude", { home, configDir, file: "commands/foo.md" })).toThrow(/skill-install output/);
  });

  test("--file escaping the config root is rejected", () => {
    expect(() => configCapture("claude", { home, configDir, file: "../escape" })).toThrow(/outside/);
    expect(() => configCapture("claude", { home, configDir, file: "/abs/path" })).toThrow(/outside/);
  });

  test("--file missing on the machine errors clearly", () => {
    expect(() => configCapture("claude", { home, configDir, file: "extras/nope.md" })).toThrow(/not found/);
  });

  test("a tracked file missing on the machine reports missing, doesn't error, and leaves the repo copy as-is", () => {
    writeTracked("claude", "gone.json", "repo-copy");
    // Not present under the machine config root.

    expect(() => configCapture("claude", { home, configDir })).not.toThrow();
    // The repo copy is untouched.
    expect(baseRead("claude", "gone.json")).toBe("repo-copy");
  });

  test("--file captures a directory recursively", () => {
    writeMachine("codex", "prompts/a.md", "a");
    writeMachine("codex", "prompts/sub/b.md", "b");

    configCapture("codex", { home, configDir, file: "prompts" });

    expect(baseRead("codex", "prompts/a.md")).toBe("a");
    expect(baseRead("codex", "prompts/sub/b.md")).toBe("b");
  });

  test("unknown target throws the unknown-target error listing valid targets", () => {
    expect(() => configCapture("nonsense", { home, configDir })).toThrow(/Unknown target: nonsense/);
  });

  test("capture never expands ${VAR}: raw bytes land in the base tree", () => {
    writeMachine("claude", "settings.json", '{"token":"${TOKEN}"}');
    configCapture("claude", { home, configDir });
    expect(baseRead("claude", "settings.json")).toBe('{"token":"${TOKEN}"}');
  });

  test("capture never writes overlay (@) directories", () => {
    writeMachine("claude", "settings.json", "{}");
    configCapture("claude", { home, configDir });
    // Only config/claude/ is written; no @ dirs are created.
    expect(existsSync(join(configDir, "@laptop"))).toBe(false);
  });
});
