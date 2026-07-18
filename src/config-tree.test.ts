import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadConfigTreeFrom } from "./config-tree";

describe("loadConfigTreeFrom", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-tree-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, content: string): void {
    const full = join(tmpDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  test("returns empty sets for a missing config dir", () => {
    const tree = loadConfigTreeFrom(join(tmpDir, "nonexistent"));
    expect(tree).toEqual({ claude: [], codex: [], pi: [], opencode: [] });
  });

  test("returns empty sets for an empty config dir", () => {
    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree).toEqual({ claude: [], codex: [], pi: [], opencode: [] });
  });

  test("scans per-target files with relative destination paths and content", () => {
    writeFixture("claude/settings.json", '{"a":1}');
    writeFixture("codex/AGENTS.md", "# codex");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude).toEqual([{ relPath: "settings.json", content: '{"a":1}' }]);
    expect(tree.codex).toEqual([{ relPath: "AGENTS.md", content: "# codex" }]);
    expect(tree.pi).toEqual([]);
    expect(tree.opencode).toEqual([]);
  });

  test("mirrors recursive subdirectories through the relative path", () => {
    writeFixture("claude/hooks/foo.sh", "echo hi");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude).toEqual([{ relPath: "hooks/foo.sh", content: "echo hi" }]);
  });

  test("silently ignores @-prefixed overlay directories", () => {
    writeFixture("@laptop/claude/settings.json", "{}");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude).toEqual([]);
  });

  test("warns and skips unknown directory names", () => {
    writeFixture("bogus/whatever.txt", "x");
    writeFixture("claude/settings.json", "{}");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude).toHaveLength(1);
    // "bogus" is not represented anywhere in the returned tree.
    expect(Object.keys(tree)).toEqual(["claude", "codex", "pi", "opencode"]);
  });

  test("throws on a banned config path (claude commands/)", () => {
    writeFixture("claude/commands/foo.md", "banned");
    expect(() => loadConfigTreeFrom(tmpDir)).toThrow(/commands/);
  });
});
