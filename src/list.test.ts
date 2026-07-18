import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { list } from "./list";

/** Run `fn` with console.log captured, returning the joined (ANSI-stripped) output. */
function captureLog(fn: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n").replace(/\[[0-9]*m/g, "");
}

describe("list config section", () => {
  let tmpDir: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-list-"));
    configDir = join(tmpDir, "config");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFixture(relPath: string, content: string): void {
    const full = join(configDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  test("renders base files per target and marks the applicable overlay", () => {
    writeFixture("claude/settings.json", "{}");
    writeFixture("claude/hooks/pre.sh", "echo hi");
    writeFixture("codex/config.toml", "");
    writeFixture("@laptop/claude/settings.json", "{}");
    writeFixture("@desktop/claude/settings.json", "{}");

    const output = captureLog(() => list({ configDir, machine: "laptop" }));

    expect(output).toContain("Config");
    expect(output).toContain("claude");
    expect(output).toContain("settings.json");
    expect(output).toContain("hooks/pre.sh");
    expect(output).toContain("config.toml");
    expect(output).toContain("this machine: laptop");
    // The matching overlay is marked; the other is listed but not.
    expect(output).toMatch(/@laptop\s+\(applies\)/);
    expect(output).toMatch(/@desktop(?!.*\(applies\))/);
  });

  test("says so when the config tree is empty", () => {
    const output = captureLog(() => list({ configDir, machine: "laptop" }));
    expect(output).toContain("No config files found");
  });
});
