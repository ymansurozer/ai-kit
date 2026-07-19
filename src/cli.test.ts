import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { parseArgs, unknownFlags } from "./cli";

describe("parseArgs", () => {
  test("parses boolean flag", () => {
    expect(parseArgs(["--global"])).toEqual({ flags: { global: true }, positionals: [] });
  });

  test("parses flag with value", () => {
    expect(parseArgs(["--skills", "a,b"])).toEqual({ flags: { skills: "a,b" }, positionals: [] });
  });

  test("parses multiple flags", () => {
    expect(parseArgs(["--global", "--skills", "a,b"])).toEqual({
      flags: { global: true, skills: "a,b" },
      positionals: [],
    });
  });

  test("value flag followed by another flag is treated as boolean", () => {
    // --from --global: since --global starts with --, --from has no value
    expect(parseArgs(["--from", "--global"])).toEqual({
      flags: { from: true, global: true },
      positionals: [],
    });
  });

  test("returns empty result for no args", () => {
    expect(parseArgs([])).toEqual({ flags: {}, positionals: [] });
  });

  test("collects non-flag arguments as positionals", () => {
    expect(parseArgs(["claude", "--global", "extra"])).toEqual({
      flags: { global: true },
      positionals: ["claude", "extra"],
    });
  });

  test("resolves a positional even when a flag comes first", () => {
    expect(parseArgs(["--force", "claude"])).toEqual({
      flags: { force: true },
      positionals: ["claude"],
    });
  });

  test("value flag consumes its value, leaving a trailing positional", () => {
    // config capture --file a.json claude: file consumes a.json, claude is the target
    expect(parseArgs(["capture", "--file", "a.json", "claude"])).toEqual({
      flags: { file: "a.json" },
      positionals: ["capture", "claude"],
    });
  });

  test("handles flag with value containing special characters", () => {
    expect(parseArgs(["--from", "org/repo"])).toEqual({ flags: { from: "org/repo" }, positionals: [] });
  });

  test("boolean flags do not consume following positional arguments", () => {
    expect(parseArgs(["--global", "claude"])).toEqual({ flags: { global: true }, positionals: ["claude"] });
  });
});

describe("unknownFlags", () => {
  test("returns flags not in the known set", () => {
    expect(unknownFlags({ froce: true, global: true }, ["force", "global"])).toEqual(["froce"]);
  });

  test("returns empty when all flags are known", () => {
    expect(unknownFlags({ force: true }, ["force"])).toEqual([]);
  });

  test("empty known set flags every provided flag", () => {
    expect(unknownFlags({ force: true }, [])).toEqual(["force"]);
  });
});

describe("cli router", () => {
  const cli = join(import.meta.dir, "cli.ts");
  let homeDir: string;

  // A fresh HOME per test so config installs write to a throwaway root, never
  // the real machine or repo.
  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-cli-"));
  });
  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir },
    });

  test("target after --force scopes to that one target (flags don't widen scope)", () => {
    // The historic bug: --force before the target left the target undefined and
    // config-installed to all four. Now the target is resolved wherever it sits,
    // so the output names claude and never the other targets. (Works whether the
    // config tree is empty — "... for claude ..." — or populated — a claude heading.)
    const out = run("config", "install", "--force", "claude").stdout;
    expect(out).toContain("claude");
    expect(out).not.toContain("codex");
    expect(out).not.toContain("opencode");
  });

  test("target before or after --force scopes identically", () => {
    const before = run("config", "install", "--force", "claude").stdout;
    const after = run("config", "install", "claude", "--force").stdout;
    for (const t of ["claude", "codex", "opencode", "pi"]) {
      expect(after.includes(t)).toBe(before.includes(t));
    }
  });

  test("stray positional on config install errors and names the argument", () => {
    const res = run("config", "install", "claude", "extra");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("extra");
  });

  test("stray positional on install errors and names the argument", () => {
    const res = run("install", "claude", "extra");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("extra");
  });

  test("unknown flag warns and names the flag", () => {
    const res = run("config", "install", "claude", "--froce");
    expect(res.stdout + res.stderr).toContain("--froce");
  });

  test("known flags do not warn", () => {
    const res = run("config", "install", "claude", "--force");
    expect(res.stdout + res.stderr).not.toContain("Unknown flag");
  });

  test("missing required target still errors", () => {
    const res = run("install");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Missing target");
  });
});
