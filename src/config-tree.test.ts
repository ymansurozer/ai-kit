import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { parse as parseToml } from "smol-toml";

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
    expect(tree.claude).toMatchObject([{ relPath: "settings.json", content: '{"a":1}' }]);
    expect(tree.codex).toMatchObject([{ relPath: "AGENTS.md", content: "# codex" }]);
    expect(tree.pi).toEqual([]);
    expect(tree.opencode).toEqual([]);
  });

  test("mirrors recursive subdirectories through the relative path", () => {
    writeFixture("claude/hooks/foo.sh", "echo hi");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude).toMatchObject([{ relPath: "hooks/foo.sh", content: "echo hi" }]);
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

  test(".gitkeep markers are never collected, at any depth", () => {
    writeFixture("claude/.gitkeep", "");
    writeFixture("claude/hooks/.gitkeep", "");
    writeFixture("claude/settings.json", "{}");

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude.map((f) => f.relPath)).toEqual(["settings.json"]);
  });

  test("an executable file's permission bits ride along as mode", () => {
    const full = join(tmpDir, "claude/hooks/notify.sh");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "#!/bin/sh\n", { mode: 0o755 });

    const tree = loadConfigTreeFrom(tmpDir);
    expect(tree.claude.find((f) => f.relPath === "hooks/notify.sh")!.mode).toBe(0o755);
  });

  test("a binary file (invalid UTF-8) is collected as a Buffer, byte-for-byte", () => {
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x41, 0x80, 0x00]);
    const full = join(tmpDir, "claude/hooks/done.aac");
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, bytes);

    const tree = loadConfigTreeFrom(tmpDir);
    const file = tree.claude.find((f) => f.relPath === "hooks/done.aac")!;
    expect(Buffer.isBuffer(file.content)).toBe(true);
    expect(file.content).toEqual(bytes);
  });
});

describe("loadConfigTreeFrom overlays", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-overlay-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, content: string): void {
    const full = join(tmpDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function claudeFile(machine: string | undefined, relPath: string) {
    return loadConfigTreeFrom(tmpDir, machine).claude.find((f) => f.relPath === relPath)!;
  }

  test("deep-merges a JSON overlay: objects merge recursively, scalars replace (PRD worked example)", () => {
    writeFixture("claude/settings.json", JSON.stringify({ model: "opus", env: { A: "1", B: "2" } }));
    writeFixture("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet", env: { B: "9" } }));

    const file = claudeFile("laptop", "settings.json");
    expect(JSON.parse(file.content as string)).toEqual({ model: "sonnet", env: { A: "1", B: "9" } });
    expect(file.overlayKeys).toEqual(["model", "env"]);
    expect(file.overlayReplaced).toBeUndefined();
  });

  test("an overlay array replaces the base array rather than concatenating", () => {
    writeFixture("claude/settings.json", JSON.stringify({ tools: ["a", "b", "c"], keep: true }));
    writeFixture("@laptop/claude/settings.json", JSON.stringify({ tools: ["x"] }));

    const file = claudeFile("laptop", "settings.json");
    expect(JSON.parse(file.content as string)).toEqual({ tools: ["x"], keep: true });
  });

  test("deep-merges a TOML overlay the same way, re-stringifying", () => {
    writeFixture("codex/config.toml", 'model = "opus"\n\n[env]\nA = "1"\nB = "2"\n');
    writeFixture("@laptop/codex/config.toml", 'model = "sonnet"\n\n[env]\nB = "9"\n');

    const file = loadConfigTreeFrom(tmpDir, "laptop").codex.find((f) => f.relPath === "config.toml")!;
    expect(parseToml(file.content as string)).toEqual({ model: "sonnet", env: { A: "1", B: "9" } });
    expect(file.overlayKeys).toEqual(["model", "env"]);
  });

  test("a non-JSON/TOML overlay replaces the base file wholesale", () => {
    writeFixture("claude/CLAUDE.md", "# base instructions");
    writeFixture("@laptop/claude/CLAUDE.md", "# laptop instructions");

    const file = claudeFile("laptop", "CLAUDE.md");
    expect(file.content).toBe("# laptop instructions");
    expect(file.overlayReplaced).toBe(true);
    expect(file.overlayKeys).toBeUndefined();
  });

  test("an overlay-only file with no base counterpart installs, marked as overlay-supplied", () => {
    writeFixture("claude/settings.json", "{}");
    writeFixture("@laptop/claude/laptop-only.json", '{"x":1}');

    const only = claudeFile("laptop", "laptop-only.json");
    expect(only.content).toBe('{"x":1}');
    expect(only.overlayReplaced).toBe(true);
  });

  test("an overlay for a target with no base tree still installs its files", () => {
    writeFixture("@laptop/pi/settings.json", '{"x":1}');

    const tree = loadConfigTreeFrom(tmpDir, "laptop");
    expect(tree.pi).toMatchObject([{ relPath: "settings.json", content: '{"x":1}', overlayReplaced: true }]);
  });

  test("an overlay for a different machine name has no effect", () => {
    writeFixture("claude/settings.json", JSON.stringify({ model: "opus" }));
    writeFixture("@desktop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    const file = claudeFile("laptop", "settings.json");
    expect(JSON.parse(file.content as string)).toEqual({ model: "opus" });
    expect(file.overlayKeys).toBeUndefined();
    expect(file.overlayReplaced).toBeUndefined();
  });

  test("with no machine given, overlay directories are ignored", () => {
    writeFixture("claude/settings.json", JSON.stringify({ model: "opus" }));
    writeFixture("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    const file = claudeFile(undefined, "settings.json");
    expect(JSON.parse(file.content as string)).toEqual({ model: "opus" });
  });

  test("a base file untouched by any overlay carries no overlay metadata", () => {
    writeFixture("claude/settings.json", JSON.stringify({ model: "opus" }));
    writeFixture("claude/CLAUDE.md", "# base");
    writeFixture("@laptop/claude/settings.json", JSON.stringify({ model: "sonnet" }));

    const untouched = claudeFile("laptop", "CLAUDE.md");
    expect(untouched.overlayKeys).toBeUndefined();
    expect(untouched.overlayReplaced).toBeUndefined();
  });

  test("banned config paths are enforced in overlay trees too", () => {
    writeFixture("@laptop/claude/commands/foo.md", "banned");
    expect(() => loadConfigTreeFrom(tmpDir, "laptop")).toThrow(/commands/);
  });

  test("a malformed JSON overlay throws an error naming the file", () => {
    writeFixture("claude/settings.json", "{}");
    writeFixture("@laptop/claude/settings.json", "{ not json");
    expect(() => loadConfigTreeFrom(tmpDir, "laptop")).toThrow(/settings\.json/);
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
