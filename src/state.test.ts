import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readStateFrom, writeStateTo, saveInstallationTo } from "./state";
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
