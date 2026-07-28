import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { loadMachineOwnedFrom } from "./machine-owned";

describe("loadMachineOwnedFrom", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ai-kit-machine-owned-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  /** Write a manifest at the config-tree root. */
  function writeManifest(content: string): void {
    writeFileSync(join(configDir, "machine-owned.json"), content);
  }

  /** Load with `log.warn` captured, returning the manifest and everything warned. */
  function loadCapturingWarnings(): { owned: ReturnType<typeof loadMachineOwnedFrom>; warnings: string } {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    try {
      const owned = loadMachineOwnedFrom(configDir);
      return { owned, warnings: spy.mock.calls.map((c) => String(c[0])).join("\n") };
    } finally {
      spy.mockRestore();
    }
  }

  test("no manifest leaves every lookup empty", () => {
    const owned = loadMachineOwnedFrom(configDir);
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual([]);
    expect(owned.ownedKeysFor("codex", "config.toml")).toEqual([]);
  });

  test("a missing config directory is inert too", () => {
    const owned = loadMachineOwnedFrom(join(configDir, "nope"));
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual([]);
  });

  test("declared keys are served per target and file", () => {
    writeManifest(
      JSON.stringify({
        claude: { "settings.json": ["model", "permissions"] },
        codex: { "config.toml": ["projects"] },
      }),
    );
    const owned = loadMachineOwnedFrom(configDir);
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual(["model", "permissions"]);
    expect(owned.ownedKeysFor("codex", "config.toml")).toEqual(["projects"]);
  });

  test("an undeclared file or target is empty", () => {
    writeManifest(JSON.stringify({ claude: { "settings.json": ["model"] } }));
    const owned = loadMachineOwnedFrom(configDir);
    expect(owned.ownedKeysFor("claude", "keybindings.json")).toEqual([]);
    expect(owned.ownedKeysFor("opencode", "settings.json")).toEqual([]);
  });

  test("nested file paths are declarable", () => {
    writeManifest(JSON.stringify({ claude: { "agents/reviewer.json": ["model"] } }));
    expect(loadMachineOwnedFrom(configDir).ownedKeysFor("claude", "agents/reviewer.json")).toEqual(["model"]);
  });

  test("an empty key array is declared but owns nothing", () => {
    writeManifest(JSON.stringify({ claude: { "settings.json": [] } }));
    expect(loadMachineOwnedFrom(configDir).ownedKeysFor("claude", "settings.json")).toEqual([]);
  });

  test("malformed JSON throws naming the manifest", () => {
    writeManifest("{oops");
    expect(() => loadMachineOwnedFrom(configDir)).toThrow(/machine-owned\.json/);
  });

  test("a non-object manifest throws naming the manifest", () => {
    writeManifest('["model"]');
    expect(() => loadMachineOwnedFrom(configDir)).toThrow(/machine-owned\.json/);
  });

  test("an unknown target is warned about and skipped, valid siblings still served", () => {
    writeManifest(JSON.stringify({ cursor: { "settings.json": ["model"] }, claude: { "settings.json": ["model"] } }));
    const { owned, warnings } = loadCapturingWarnings();
    expect(warnings).toContain("cursor");
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual(["model"]);
  });

  test("a target whose value is not an object is warned about and skipped", () => {
    writeManifest(JSON.stringify({ claude: ["model"], codex: { "config.toml": ["projects"] } }));
    const { owned, warnings } = loadCapturingWarnings();
    expect(warnings).toContain("claude");
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual([]);
    expect(owned.ownedKeysFor("codex", "config.toml")).toEqual(["projects"]);
  });

  test("a non-structured file is warned about and skipped", () => {
    writeManifest(JSON.stringify({ claude: { "CLAUDE.md": ["model"], "settings.json": ["model"] } }));
    const { owned, warnings } = loadCapturingWarnings();
    expect(warnings).toContain("CLAUDE.md");
    expect(owned.ownedKeysFor("claude", "CLAUDE.md")).toEqual([]);
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual(["model"]);
  });

  test("a value that is not an array of strings is warned about and skipped", () => {
    writeManifest(
      JSON.stringify({
        claude: { "settings.json": "model", "keybindings.json": [1, 2], "agents/a.json": ["model"] },
      }),
    );
    const { owned, warnings } = loadCapturingWarnings();
    expect(warnings).toContain("settings.json");
    expect(warnings).toContain("keybindings.json");
    expect(owned.ownedKeysFor("claude", "settings.json")).toEqual([]);
    expect(owned.ownedKeysFor("claude", "keybindings.json")).toEqual([]);
    expect(owned.ownedKeysFor("claude", "agents/a.json")).toEqual(["model"]);
  });

  test("a file not present in the config tree is still declarable", () => {
    writeManifest(JSON.stringify({ claude: { "settings.json": ["model"] } }));
    const spy = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(loadMachineOwnedFrom(configDir).ownedKeysFor("claude", "settings.json")).toEqual(["model"]);
      expect(spy.mock.calls).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("a valid manifest warns about nothing", () => {
    writeManifest(JSON.stringify({ codex: { "config.toml": ["projects"] } }));
    const { warnings } = loadCapturingWarnings();
    expect(warnings).toBe("");
  });
});
