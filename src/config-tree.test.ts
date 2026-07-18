import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { expandEnvVars, loadConfigTreeFrom } from "./config-tree";

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

describe("expandEnvVars", () => {
  test("passes through content with no placeholders unchanged", () => {
    const result = expandEnvVars('{"a":1}', {});
    expect(result).toEqual({ content: '{"a":1}', missing: [] });
  });

  test("substitutes a single placeholder from the environment", () => {
    const result = expandEnvVars("token=${TEST_TOKEN}", { TEST_TOKEN: "abc123" });
    expect(result).toEqual({ content: "token=abc123", missing: [] });
  });

  test("expands multiple distinct vars in one file", () => {
    const result = expandEnvVars("${A}/${B}", { A: "one", B: "two" });
    expect(result).toEqual({ content: "one/two", missing: [] });
  });

  test("expands placeholders adjacent to surrounding text", () => {
    const result = expandEnvVars("Bearer ${TOKEN} at ${HOME}/bin/x", { TOKEN: "t", HOME: "/root" });
    expect(result).toEqual({ content: "Bearer t at /root/bin/x", missing: [] });
  });

  test("expands every occurrence of a repeated var", () => {
    const result = expandEnvVars("${V}-${V}", { V: "x" });
    expect(result).toEqual({ content: "x-x", missing: [] });
  });

  test("collects unset vars deduplicated in order of first appearance, leaving placeholders", () => {
    const result = expandEnvVars("${B} ${A} ${B} ${SET}", { SET: "ok" });
    expect(result.missing).toEqual(["B", "A"]);
    expect(result.content).toBe("${B} ${A} ${B} ok");
  });
});
