import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

// The config phase rides the main `install` flow only on global installs, and both
// it and the target installer's MCP merge write under the real home directory. These
// tests drive `install`/`sync` in a subprocess with a temp HOME and a temp config
// tree injected via AI_KIT_CONFIG_DIR, so nothing touches the real home directory
// or the repo's live config/ tree (which holds real config in a personal fork).

const repoRoot = join(import.meta.dir, "..");
const installUrl = pathToFileURL(join(repoRoot, "src", "install.ts")).href;
const syncUrl = pathToFileURL(join(repoRoot, "src", "sync.ts")).href;

function run(script: string, homeDir: string, configDir: string): { status: number; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    env: { ...process.env, HOME: homeDir, AI_KIT_CONFIG_DIR: configDir },
    encoding: "utf8",
  });
  return { status: r.status ?? 1, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

function runInstallFrom(target: string, options: Record<string, unknown>, homeDir: string, configDir: string) {
  return run(
    `import { install } from ${JSON.stringify(installUrl)};\n` +
      `install(${JSON.stringify(target)}, ${JSON.stringify(options)});`,
    homeDir,
    configDir,
  );
}

function runSyncFrom(homeDir: string, configDir: string) {
  return run(`import { sync } from ${JSON.stringify(syncUrl)};\nsync();`, homeDir, configDir);
}

describe("global install config phase", () => {
  let homeDir: string;
  let projectDir: string;
  let configDir: string;
  let mcpName: string;
  let mcpPath: string;

  beforeEach(() => {
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-cfg-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "ai-kit-cfg-project-"));
    configDir = mkdtempSync(join(tmpdir(), "ai-kit-cfg-tree-"));
    mcpName = `cfg-mcp-${suffix}`;
    mcpPath = join(repoRoot, "mcps", `${mcpName}.json`);

    writeFileSync(
      mcpPath,
      JSON.stringify({ description: "test mcp", config: { command: "npx", args: ["-y", "@test/pw"] } }, null, 2) + "\n",
    );

    writeConfig("claude/settings.json", '{"model":"opus"}');
    writeConfig("codex/config.toml", 'model = "gpt-5-codex"\n');
    writeConfig("pi/settings.json", '{"theme":"dark"}');
    writeConfig("opencode/opencode.json", '{"theme":"opencode-dark"}');
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(mcpPath, { force: true });
  });

  function writeConfig(relPath: string, content: string): void {
    const full = join(configDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  test("install <target> --global writes config alongside MCPs; per-repo leaves config roots untouched", () => {
    const global = runInstallFrom("codex", { global: true, skills: [], mcps: [mcpName] }, homeDir, configDir);
    expect(global.status).toBe(0);

    const codexConfig = join(homeDir, ".codex", "config.toml");
    const content = readFileSync(codexConfig, "utf-8");
    expect(content).toContain('model = "gpt-5-codex"');
    expect(content).toContain(`[mcp_servers.${mcpName}]`);

    // A per-repo install (no --global) never touches the config root.
    const perRepoHome = mkdtempSync(join(tmpdir(), "ai-kit-cfg-home2-"));
    try {
      const perRepo = runInstallFrom(
        "codex",
        { global: false, cwd: projectDir, skills: [], mcps: [mcpName] },
        perRepoHome,
        configDir,
      );
      expect(perRepo.status).toBe(0);
      expect(existsSync(join(perRepoHome, ".codex", "config.toml"))).toBe(false);
    } finally {
      rmSync(perRepoHome, { recursive: true, force: true });
    }
  });

  test("Codex config.toml holds both repo config and MCP sections; an immediate second run reports zero drift", () => {
    const first = runInstallFrom("codex", { global: true, skills: [], mcps: [mcpName] }, homeDir, configDir);
    expect(first.status).toBe(0);

    const dest = join(homeDir, ".codex", "config.toml");
    const afterFirst = readFileSync(dest, "utf-8");
    expect(afterFirst).toContain('model = "gpt-5-codex"');
    expect(afterFirst).toContain(`[mcp_servers.${mcpName}]`);

    // Second run with nothing changed: the recorded hash covers the post-merge file,
    // so config.toml is not flagged as drifted and the final bytes are identical.
    const second = runInstallFrom("codex", { global: true, skills: [], mcps: [mcpName] }, homeDir, configDir);
    expect(second.status).toBe(0);
    expect(second.stdout + second.stderr).not.toContain("drifted");
    expect(readFileSync(dest, "utf-8")).toBe(afterFirst);
  });

  test("Pi receives config files and no MCP config (behavior 11)", () => {
    const result = runInstallFrom("pi", { global: true, skills: [], mcps: [mcpName] }, homeDir, configDir);
    expect(result.status).toBe(0);

    expect(readFileSync(join(homeDir, ".pi", "agent", "settings.json"), "utf-8")).toBe('{"theme":"dark"}');
    // Pi has no MCP destination anywhere.
    expect(existsSync(join(homeDir, ".codex", "config.toml"))).toBe(false);
  });

  test("install all --global fans config out to every target", () => {
    const result = runInstallFrom("all", { global: true, skills: [], mcps: [mcpName] }, homeDir, configDir);
    expect(result.status).toBe(0);

    expect(existsSync(join(homeDir, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(homeDir, ".codex", "config.toml"))).toBe(true);
    expect(existsSync(join(homeDir, ".pi", "agent", "settings.json"))).toBe(true);
    expect(existsSync(join(homeDir, ".config", "opencode", "opencode.json"))).toBe(true);

    // Every target's global entry is recorded as config-bearing.
    const state = JSON.parse(readFileSync(join(homeDir, ".ai-kit", "state.json"), "utf-8"));
    for (const inst of state.installations) {
      expect(inst.config).toBe(true);
    }
  });
});

describe("sync propagates config to tracked global targets (behaviors 14, 15)", () => {
  let homeDir: string;
  let configDir: string;
  let statePath: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-cfg-sync-"));
    configDir = mkdtempSync(join(tmpdir(), "ai-kit-cfg-sync-tree-"));
    statePath = join(homeDir, ".ai-kit", "state.json");
    mkdirSync(join(homeDir, ".ai-kit"), { recursive: true });
    writeConfig("claude/settings.json", '{"model":"opus"}');
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  function writeConfig(relPath: string, content: string): void {
    const full = join(configDir, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function seedState(installations: unknown[]): void {
    writeFileSync(statePath, JSON.stringify({ installations }, null, 2) + "\n");
  }

  test("a config-only state entry (skills:[], mcps:[]) still gets its config phase on sync", () => {
    seedState([
      {
        target: "claude",
        global: true,
        config: true,
        skills: [],
        mcps: [],
        configFiles: {},
        installedAt: "2026-01-01",
      },
    ]);

    const result = runSyncFrom(homeDir, configDir);
    expect(result.status).toBe(0);
    expect(readFileSync(join(homeDir, ".claude", "settings.json"), "utf-8")).toBe('{"model":"opus"}');
  });

  test("a file added to the config tree lands on a tracked global target at the next sync", () => {
    seedState([
      {
        target: "claude",
        global: true,
        config: true,
        skills: [],
        mcps: [],
        configFiles: {},
        installedAt: "2026-01-01",
      },
    ]);

    // First sync installs the existing file and records its hash.
    expect(runSyncFrom(homeDir, configDir).status).toBe(0);
    expect(existsSync(join(homeDir, ".claude", "settings.json"))).toBe(true);

    // A new file appears in the tree; the next sync re-scans and installs it.
    writeConfig("claude/CLAUDE.md", "# added later");
    expect(runSyncFrom(homeDir, configDir).status).toBe(0);
    expect(readFileSync(join(homeDir, ".claude", "CLAUDE.md"), "utf-8")).toBe("# added later");
  });

  test("a sync over a drifted config file completes successfully (no failure, no backoff)", () => {
    // Install once so the destination is managed and its hash recorded.
    seedState([
      {
        target: "claude",
        global: true,
        config: true,
        skills: [],
        mcps: [],
        configFiles: {},
        installedAt: "2026-01-01",
      },
    ]);
    expect(runSyncFrom(homeDir, configDir).status).toBe(0);

    // A human (or the harness) edits the destination out from under ai-kit.
    const dest = join(homeDir, ".claude", "settings.json");
    writeFileSync(dest, '{"model":"hand-edited"}');

    // Sync must report the drift skip but exit cleanly — a drift skip is not an
    // install failure, so watch never backs off.
    const result = runSyncFrom(homeDir, configDir);
    expect(result.status).toBe(0);
    expect(readFileSync(dest, "utf-8")).toBe('{"model":"hand-edited"}');
  });
});
