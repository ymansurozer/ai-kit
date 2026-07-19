import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  readStateFrom,
  writeStateTo,
  saveInstallationTo,
  mergeSelection,
  mergeConfigFiles,
  findInstallationFrom,
} from "./state";
import type { Installation } from "./state";

describe("state", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-state-"));
    statePath = join(tmpDir, "state.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("readStateFrom returns empty state when file missing", () => {
    const state = readStateFrom(statePath);
    expect(state).toEqual({ installations: [] });
  });

  test("a corrupt state file fails naming the file and hinting recovery", () => {
    writeFileSync(statePath, "{ this is not json");
    expect(() => readStateFrom(statePath)).toThrow(statePath);
    expect(() => readStateFrom(statePath)).toThrow(/inspect or delete .* and re-run ai-kit install/);
  });

  test("writeStateTo + readStateFrom round-trips correctly", () => {
    const state = {
      installations: [
        {
          target: "claude",
          global: true,
          skills: ["review"],
          mcps: ["playwright"],
          installedAt: "2026-01-01T00:00:00Z",
        },
      ],
    };

    writeStateTo(statePath, state);
    const loaded = readStateFrom(statePath);
    expect(loaded).toEqual(state);
  });

  test("saveInstallationTo adds new installation", () => {
    const inst: Installation = {
      target: "claude",
      global: false,
      path: "/some/path",
      skills: ["a"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };

    saveInstallationTo(statePath, inst);
    const state = readStateFrom(statePath);
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].target).toBe("claude");
  });

  test("saveInstallationTo updates existing matching installation", () => {
    const inst1: Installation = {
      target: "claude",
      global: true,
      skills: ["a"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };
    const inst2: Installation = {
      target: "claude",
      global: true,
      skills: ["a", "b"],
      mcps: ["pw"],
      installedAt: "2026-02-01T00:00:00Z",
    };

    saveInstallationTo(statePath, inst1);
    saveInstallationTo(statePath, inst2);

    const state = readStateFrom(statePath);
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].skills).toEqual(["a", "b"]);
    expect(state.installations[0].installedAt).toBe("2026-02-01T00:00:00Z");
  });

  test("saveInstallationTo does not overwrite different installation", () => {
    const claude: Installation = {
      target: "claude",
      global: true,
      skills: ["a"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };
    const codex: Installation = {
      target: "codex",
      global: true,
      skills: ["b"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };

    saveInstallationTo(statePath, claude);
    saveInstallationTo(statePath, codex);

    const state = readStateFrom(statePath);
    expect(state.installations).toHaveLength(2);
  });

  test("saveInstallationTo merges selections monotonically (all wins, else union)", () => {
    // A full install ("all" = undefined) after a prior cherry-picked list promotes
    // the record back to "all" — un-freezing it so sync re-scans the repo.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      skills: ["a"],
      mcps: ["x"],
      installedAt: "2026-01-01T00:00:00Z",
    });
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      skills: undefined,
      mcps: undefined,
      installedAt: "2026-02-01T00:00:00Z",
    });
    let inst = readStateFrom(statePath).installations[0];
    expect(inst.skills).toBeUndefined();
    expect(inst.mcps).toBeUndefined();

    // A later cherry-picked install must NOT narrow an existing "all" record.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      skills: ["only-this"],
      mcps: ["only-that"],
      installedAt: "2026-03-01T00:00:00Z",
    });
    inst = readStateFrom(statePath).installations[0];
    expect(inst.skills).toBeUndefined();
    expect(inst.mcps).toBeUndefined();
  });

  test("config flag sticks across a later install that omits it", () => {
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      config: true,
      skills: [],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    });
    // A regular global install of the same key does not carry config:true.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      skills: undefined,
      mcps: undefined,
      installedAt: "2026-02-01T00:00:00Z",
    });

    const inst = readStateFrom(statePath).installations[0];
    expect(inst.config).toBe(true);
    // The regular install still promotes selections to "all".
    expect(inst.skills).toBeUndefined();
    expect(inst.mcps).toBeUndefined();
  });

  test("saveInstallationTo merges configFiles hashes per key (new wins, untouched kept)", () => {
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      config: true,
      skills: [],
      mcps: [],
      configFiles: { "settings.json": "hashA", "CLAUDE.md": "hashB" },
      installedAt: "2026-01-01T00:00:00Z",
    });
    // A later run rewrites only settings.json; CLAUDE.md keeps its prior hash.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      config: true,
      skills: [],
      mcps: [],
      configFiles: { "settings.json": "hashA2" },
      installedAt: "2026-02-01T00:00:00Z",
    });

    const inst = readStateFrom(statePath).installations[0];
    expect(inst.configFiles).toEqual({ "settings.json": "hashA2", "CLAUDE.md": "hashB" });
  });

  test("mergeConfigFiles merges new over prev, undefined only when both empty", () => {
    expect(mergeConfigFiles({ a: "1" }, { a: "2", b: "3" })).toEqual({ a: "2", b: "3" });
    expect(mergeConfigFiles({ a: "1" }, undefined)).toEqual({ a: "1" });
    expect(mergeConfigFiles(undefined, { b: "2" })).toEqual({ b: "2" });
    expect(mergeConfigFiles(undefined, undefined)).toBeUndefined();
  });

  test("findInstallationFrom matches on target + global + path", () => {
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      config: true,
      configFiles: { "settings.json": "h" },
      skills: [],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    });
    expect(findInstallationFrom(statePath, "claude", true, "/home/u")?.configFiles).toEqual({ "settings.json": "h" });
    expect(findInstallationFrom(statePath, "codex", true, "/home/u")).toBeUndefined();
  });

  test("an old-format entry lacking configFiles loads and merges without error", () => {
    writeStateTo(statePath, {
      installations: [
        { target: "claude", global: true, path: "/home/u", config: true, skills: [], mcps: [], installedAt: "old" },
      ],
    });
    // Merging a new hash map onto an entry with no prior map just adopts the new map.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      path: "/home/u",
      config: true,
      skills: [],
      mcps: [],
      configFiles: { "settings.json": "h1" },
      installedAt: "new",
    });
    expect(readStateFrom(statePath).installations[0].configFiles).toEqual({ "settings.json": "h1" });
  });

  test("installedSkills/installedMcps snapshots are replaced wholesale, not unioned", () => {
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      installedSkills: ["a", "b"],
      installedMcps: ["x", "y"],
      installedAt: "2026-01-01T00:00:00Z",
    });
    // A later run installed a narrower set — the snapshot must reflect exactly that,
    // NOT the union (which is how the selection fields merge).
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      installedSkills: ["a"],
      installedMcps: ["x"],
      installedAt: "2026-02-01T00:00:00Z",
    });
    const inst = readStateFrom(statePath).installations[0];
    expect(inst.installedSkills).toEqual(["a"]);
    expect(inst.installedMcps).toEqual(["x"]);
  });

  test("an empty snapshot array replaces a prior one (recorded: installed nothing)", () => {
    saveInstallationTo(statePath, {
      target: "codex",
      global: true,
      installedSkills: ["a"],
      installedMcps: ["x"],
      installedAt: "2026-01-01T00:00:00Z",
    });
    // The user deleted their last skill/MCP: this run installed nothing, and the
    // snapshot records `[]` — distinct from `undefined` (never recorded).
    saveInstallationTo(statePath, {
      target: "codex",
      global: true,
      installedSkills: [],
      installedMcps: [],
      installedAt: "2026-02-01T00:00:00Z",
    });
    const inst = readStateFrom(statePath).installations[0];
    expect(inst.installedSkills).toEqual([]);
    expect(inst.installedMcps).toEqual([]);
  });

  test("a save that omits the snapshot leaves a prior snapshot untouched", () => {
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      installedSkills: ["a"],
      installedMcps: ["x"],
      installedAt: "2026-01-01T00:00:00Z",
    });
    // A config-only install (configInstall) saves without a snapshot — it must not
    // clobber a real install's recorded snapshot back to undefined.
    saveInstallationTo(statePath, {
      target: "claude",
      global: true,
      config: true,
      skills: [],
      mcps: [],
      installedAt: "2026-02-01T00:00:00Z",
    });
    const inst = readStateFrom(statePath).installations[0];
    expect(inst.installedSkills).toEqual(["a"]);
    expect(inst.installedMcps).toEqual(["x"]);
  });

  test("a legacy entry lacking snapshots loads fine and yields no snapshot", () => {
    writeStateTo(statePath, {
      installations: [
        { target: "claude", global: true, path: "/home/u", skills: ["a"], mcps: ["x"], installedAt: "old" },
      ],
    });
    const inst = findInstallationFrom(statePath, "claude", true, "/home/u");
    expect(inst?.installedSkills).toBeUndefined();
    expect(inst?.installedMcps).toBeUndefined();
  });

  test("mergeSelection unions two explicit lists without duplicates", () => {
    expect(mergeSelection(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(mergeSelection(["a"], undefined)).toBeUndefined();
    expect(mergeSelection(undefined, ["a"])).toBeUndefined();
    expect(mergeSelection(undefined, undefined)).toBeUndefined();
  });

  test("matches by target + global + path combination", () => {
    const local: Installation = {
      target: "claude",
      global: false,
      path: "/project-a",
      skills: ["a"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };
    const localOther: Installation = {
      target: "claude",
      global: false,
      path: "/project-b",
      skills: ["b"],
      mcps: [],
      installedAt: "2026-01-01T00:00:00Z",
    };

    saveInstallationTo(statePath, local);
    saveInstallationTo(statePath, localOther);

    const state = readStateFrom(statePath);
    expect(state.installations).toHaveLength(2);
  });
});
