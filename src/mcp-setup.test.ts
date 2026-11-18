import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import type { McpConfig } from "./config";
import { isSetupReady, runMcpSetupsFrom, type SetupRunner } from "./mcp-setup";
import { readStateFrom } from "./state";

const mcp = (name: string, setupArgs?: string[], creates?: string): McpConfig => ({
  name,
  description: "",
  config: { command: "sh", args: ["-c", `exec ${name}`] },
  path: `/repo/mcps/${name}.json`,
  setup: setupArgs ? { command: "sh", args: setupArgs, creates } : undefined,
});

const setupUrl = pathToFileURL(join(import.meta.dir, "mcp-setup.ts")).href;

describe("runMcpSetupsFrom", () => {
  let tmpDir: string;
  let statePath: string;
  let calls: { command: string; args: string[] }[];
  let status: number;

  // The system boundary: records each spawn instead of running it.
  const runner: SetupRunner = (command, args) => {
    calls.push({ command, args });
    return { status };
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-setup-"));
    statePath = join(tmpDir, "state.json");
    calls = [];
    status = 0;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("runs an MCP's setup command once, then skips it on later runs", () => {
    const browser = mcp("browser", ["-c", "npm install tool@1.0.0"]);

    runMcpSetupsFrom(statePath, [browser], runner, new Set());
    expect(calls).toEqual([{ command: "sh", args: ["-c", "npm install tool@1.0.0"] }]);

    runMcpSetupsFrom(statePath, [browser], runner, new Set());
    expect(calls).toHaveLength(1);
  });

  test("runs the setup again when its version changes", () => {
    runMcpSetupsFrom(statePath, [mcp("browser", ["-c", "npm install tool@1.0.0"])], runner, new Set());
    runMcpSetupsFrom(statePath, [mcp("browser", ["-c", "npm install tool@1.1.0"])], runner, new Set());

    expect(calls.map((c) => c.args[1])).toEqual(["npm install tool@1.0.0", "npm install tool@1.1.0"]);
  });

  test("a failed setup is reported not ready and not recorded, so the next run retries it", () => {
    const browser = mcp("browser", ["-c", "npm install tool@1.0.0"]);

    status = 1;
    expect(runMcpSetupsFrom(statePath, [browser, mcp("plain")], runner, new Set())).toEqual(["browser"]);
    expect(readStateFrom(statePath).mcpSetups).toBeUndefined();

    status = 0;
    expect(runMcpSetupsFrom(statePath, [browser], runner, new Set())).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(Object.keys(readStateFrom(statePath).mcpSetups ?? {})).toEqual(["browser"]);
  });

  test("within one run, a setup is attempted at most once even when it fails", () => {
    const browser = mcp("browser", ["-c", "npm install tool@1.0.0"]);
    const thisRun = new Set<string>();

    status = 1;
    runMcpSetupsFrom(statePath, [browser], runner, thisRun);
    // Still reported not ready on the repeat, so every target holds it back alike.
    expect(runMcpSetupsFrom(statePath, [browser], runner, thisRun)).toEqual(["browser"]);

    expect(calls).toHaveLength(1);
  });

  test("a deleted creates path makes the setup run again", () => {
    const created = join(tmpDir, "install", "bin");
    const browser = mcp("browser", ["-c", "npm install tool@1.0.0"], created);
    const installing: SetupRunner = (command, args) => {
      mkdirSync(join(tmpDir, "install"), { recursive: true });
      writeFileSync(created, "");
      return runner(command, args);
    };

    runMcpSetupsFrom(statePath, [browser], installing, new Set());
    runMcpSetupsFrom(statePath, [browser], installing, new Set());
    expect(calls).toHaveLength(1);

    rmSync(created);
    runMcpSetupsFrom(statePath, [browser], installing, new Set());
    expect(calls).toHaveLength(2);
  });

  test("a repair that recreates the creates path but then fails stays not ready", () => {
    const created = join(tmpDir, "install", "bin");
    const browser = mcp("browser", ["-c", "npm install tool@1.0.0 && tool install-browser"], created);
    // npm recreates the launcher either way; `status` decides whether the rest succeeded.
    const installing: SetupRunner = (command, args) => {
      mkdirSync(join(tmpDir, "install"), { recursive: true });
      writeFileSync(created, "");
      return runner(command, args);
    };

    runMcpSetupsFrom(statePath, [browser], installing, new Set());
    rmSync(created);

    status = 1;
    expect(runMcpSetupsFrom(statePath, [browser], installing, new Set())).toEqual(["browser"]);
    expect(existsSync(created)).toBe(true);
    // The old hash no longer vouches for the half-rebuilt install.
    expect(isSetupReady(statePath, browser)).toBe(false);
  });

  test("a command that exits 0 without making its creates path is not recorded", () => {
    const browser = mcp("browser", ["-c", "true"], join(tmpDir, "never"));

    runMcpSetupsFrom(statePath, [browser], runner, new Set());

    expect(readStateFrom(statePath).mcpSetups).toBeUndefined();
  });

  test("a setup whose creates path never appears stays not ready", () => {
    const browser = mcp("browser", ["-c", "true"], join(tmpDir, "never"));

    expect(runMcpSetupsFrom(statePath, [browser], runner, new Set())).toEqual(["browser"]);
  });

  test("takes over a stale lock left by a crashed run, and releases its own", () => {
    const browser = mcp("browser", ["-c", "true"]);
    // A first run whose setup fails reveals the lock file it holds while running.
    let lockPath = "";
    runMcpSetupsFrom(
      statePath,
      [browser],
      () => {
        lockPath = join(tmpDir, "locks", readdirSync(join(tmpDir, "locks"))[0]);
        return { status: 1 };
      },
      new Set(),
    );
    // Leave it behind as a crashed run would, a minute old.
    writeFileSync(lockPath, "");
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    runMcpSetupsFrom(statePath, [browser], runner, new Set(), { staleMs: 1000, pollMs: 10 });

    expect(calls).toHaveLength(1);
    expect(existsSync(lockPath)).toBe(false);
  });

  test("a slow owner whose lock was taken over leaves its successor's lock in place", () => {
    let lockPath = "";
    runMcpSetupsFrom(
      statePath,
      [mcp("browser", ["-c", "true"])],
      () => {
        // While this setup runs, its lock goes stale and another run takes it over.
        lockPath = join(tmpDir, "locks", readdirSync(join(tmpDir, "locks"))[0]);
        writeFileSync(lockPath, "successor");
        return { status: 0 };
      },
      new Set(),
    );

    expect(readFileSync(lockPath, "utf-8")).toBe("successor");
  });

  test("concurrent runs in separate processes run a setup once", async () => {
    const log = join(tmpDir, "setup.log");
    const created = join(tmpDir, "created");
    const script = `
      import { runMcpSetupsFrom } from ${JSON.stringify(setupUrl)};
      runMcpSetupsFrom(${JSON.stringify(statePath)}, [{
        name: "browser", description: "", path: "", config: { command: "true" },
        setup: { command: "sh", args: ["-c", ${JSON.stringify(`sleep 1; echo ran >> ${log}; touch ${created}`)}], creates: ${JSON.stringify(created)} },
      }]);`;
    const runs = [1, 2].map(() => Bun.spawn([process.execPath, "-e", script], { stdout: "ignore", stderr: "ignore" }));

    expect(await Promise.all(runs.map((r) => r.exited))).toEqual([0, 0]);
    expect(readFileSync(log, "utf-8")).toBe("ran\n");
  });

  test("MCPs without a setup run nothing and leave state alone", () => {
    runMcpSetupsFrom(statePath, [mcp("plain")], runner, new Set());

    expect(calls).toEqual([]);
    expect(existsSync(statePath)).toBe(false);
  });

  test("keeps the rest of state intact when recording a setup", () => {
    runMcpSetupsFrom(statePath, [mcp("browser", ["-c", "true"])], runner, new Set());

    expect(readStateFrom(statePath).installations).toEqual([]);
  });
});
