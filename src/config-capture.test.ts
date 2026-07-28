import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { configCapture } from "./config-capture";
import { configRootFor } from "./targets/descriptors";

/** Capture console.log output (log.warn/success/info all route through it). */
function captureLogs(fn: () => void): string[] {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return logs;
}

describe("configCapture", () => {
  let tmpDir: string;
  let home: string;
  let configDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-config-capture-"));
    home = join(tmpDir, "home");
    configDir = join(tmpDir, "config");
    mkdirSync(home, { recursive: true });
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write a file under a target's machine config root (the "live machine"). */
  function writeMachine(target: string, relPath: string, content: string): void {
    const full = join(configRootFor(target as never, home), relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  /** Write a file into the repo BASE config tree (an already-tracked file). */
  function writeTracked(target: string, relPath: string, content: string): void {
    const full = join(configDir, target, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  function baseRead(target: string, relPath: string): string {
    return readFileSync(join(configDir, target, relPath), "utf-8");
  }

  function baseExists(target: string, relPath: string): boolean {
    return existsSync(join(configDir, target, relPath));
  }

  test("no-arg capture copies exactly tracked ∪ curated into the base tree; junk is untouched", () => {
    // Curated well-known files present on the machine.
    writeMachine("claude", "settings.json", '{"model":"opus"}');
    writeMachine("claude", "CLAUDE.md", "# claude");
    // Non-curated runtime junk on the machine.
    writeMachine("claude", "history.jsonl", "line1\n");
    writeMachine("claude", "projects/foo.json", "{}");
    // A repo tree already tracking one non-curated file that exists on the machine.
    writeMachine("claude", "custom.txt", "live-custom");
    writeTracked("claude", "custom.txt", "old-custom");

    configCapture("claude", { home, configDir });

    // Curated files captured.
    expect(baseRead("claude", "settings.json")).toBe('{"model":"opus"}');
    expect(baseRead("claude", "CLAUDE.md")).toBe("# claude");
    // Tracked non-curated file refreshed from the machine.
    expect(baseRead("claude", "custom.txt")).toBe("live-custom");
    // Junk never enters the base tree.
    expect(baseExists("claude", "history.jsonl")).toBe(false);
    expect(baseExists("claude", "projects/foo.json")).toBe(false);
    // Junk on the machine is left in place.
    expect(readFileSync(join(configRootFor("claude", home), "history.jsonl"), "utf-8")).toBe("line1\n");
  });

  test("capture <target> touches only that target's subtree", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("codex", "config.toml", 'model = "gpt-5"\n');

    configCapture("claude", { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    expect(existsSync(join(configDir, "codex"))).toBe(false);
  });

  test("no-arg capture visits every target", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("codex", "config.toml", 'model = "gpt-5"\n');

    configCapture(undefined, { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    expect(baseExists("codex", "config.toml")).toBe(true);
  });

  test("--file starts tracking an arbitrary non-curated file; a later no-arg capture refreshes it", () => {
    writeMachine("claude", "extras/notes.md", "v1");

    configCapture("claude", { home, configDir, file: "extras/notes.md" });
    expect(baseRead("claude", "extras/notes.md")).toBe("v1");

    // Now tracked: a subsequent no-arg capture refreshes it from the machine.
    writeMachine("claude", "extras/notes.md", "v2");
    configCapture("claude", { home, configDir });
    expect(baseRead("claude", "extras/notes.md")).toBe("v2");
  });

  test("--file requires an explicit target", () => {
    expect(() => configCapture(undefined, { home, configDir, file: "settings.json" })).toThrow(
      /--file requires an explicit target/,
    );
    expect(() => configCapture("all", { home, configDir, file: "settings.json" })).toThrow(
      /--file requires an explicit target/,
    );
  });

  test("a curated directory captures recursively", () => {
    writeMachine("claude", "hooks/pre.sh", "echo pre");
    writeMachine("claude", "hooks/nested/post.sh", "echo post");

    configCapture("claude", { home, configDir });

    expect(baseRead("claude", "hooks/pre.sh")).toBe("echo pre");
    expect(baseRead("claude", "hooks/nested/post.sh")).toBe("echo post");
  });

  test("a curated directory's __pycache__ contents and .DS_Store are never captured", () => {
    writeMachine("claude", "hooks/pre.sh", "echo pre");
    writeMachine("claude", "hooks/__pycache__/pre.cpython-311.pyc", "junk");
    writeMachine("claude", "hooks/.DS_Store", "junk");

    configCapture("claude", { home, configDir });

    expect(baseRead("claude", "hooks/pre.sh")).toBe("echo pre");
    expect(baseExists("claude", "hooks/__pycache__/pre.cpython-311.pyc")).toBe(false);
    expect(existsSync(join(configDir, "claude", "hooks", "__pycache__"))).toBe(false);
    expect(baseExists("claude", "hooks/.DS_Store")).toBe(false);
  });

  test("implicit capture never grabs a banned path (claude skills/)", () => {
    writeMachine("claude", "settings.json", "{}");
    writeMachine("claude", "skills/foo/SKILL.md", "ai-kit output");
    // Even a base tree that tracks it (shouldn't happen, but capture reads raw).
    writeTracked("claude", "skills/foo/SKILL.md", "stale");

    configCapture("claude", { home, configDir });

    expect(baseExists("claude", "settings.json")).toBe(true);
    // The tracked banned path is neither refreshed nor newly grabbed.
    expect(baseRead("claude", "skills/foo/SKILL.md")).toBe("stale");
  });

  test("--file inside a banned path errors with the explanation", () => {
    writeMachine("claude", "skills/foo/SKILL.md", "ai-kit output");
    expect(() => configCapture("claude", { home, configDir, file: "skills/foo/SKILL.md" })).toThrow(
      /skill-install output/,
    );
  });

  test("--file escaping the config root is rejected", () => {
    expect(() => configCapture("claude", { home, configDir, file: "../escape" })).toThrow(/outside/);
    expect(() => configCapture("claude", { home, configDir, file: "/abs/path" })).toThrow(/outside/);
  });

  test("--file missing on the machine errors clearly", () => {
    expect(() => configCapture("claude", { home, configDir, file: "extras/nope.md" })).toThrow(/not found/);
  });

  test("a tracked file missing on the machine reports missing, doesn't error, and leaves the repo copy as-is", () => {
    writeTracked("claude", "gone.json", "repo-copy");
    // Not present under the machine config root.

    expect(() => configCapture("claude", { home, configDir })).not.toThrow();
    // The repo copy is untouched.
    expect(baseRead("claude", "gone.json")).toBe("repo-copy");
  });

  test("--file captures a directory recursively", () => {
    writeMachine("codex", "prompts/a.md", "a");
    writeMachine("codex", "prompts/sub/b.md", "b");

    configCapture("codex", { home, configDir, file: "prompts" });

    expect(baseRead("codex", "prompts/a.md")).toBe("a");
    expect(baseRead("codex", "prompts/sub/b.md")).toBe("b");
  });

  test("unknown target throws the unknown-target error listing valid targets", () => {
    expect(() => configCapture("nonsense", { home, configDir })).toThrow(/Unknown target: nonsense/);
  });

  test("capture never expands ${VAR}: raw bytes land in the base tree", () => {
    writeMachine("claude", "settings.json", '{"token":"${TOKEN}"}');
    configCapture("claude", { home, configDir });
    expect(baseRead("claude", "settings.json")).toBe('{"token":"${TOKEN}"}');
  });

  test("capture never writes overlay (@) directories", () => {
    writeMachine("claude", "settings.json", "{}");
    configCapture("claude", { home, configDir });
    // Only config/claude/ is written; no @ dirs are created.
    expect(existsSync(join(configDir, "@laptop"))).toBe(false);
  });

  /** Write a fixture mcps/ dir with one `<name>.json` per name, plus an empty
   * servers dir, and return the option seams pointing capture at them. */
  function mcpSeams(...names: string[]): { mcpsDir: string; serversDir: string } {
    const mcpsDir = join(tmpDir, "mcps");
    const serversDir = join(tmpDir, "servers");
    mkdirSync(mcpsDir, { recursive: true });
    for (const name of names) {
      writeFileSync(join(mcpsDir, `${name}.json`), JSON.stringify({ config: { command: "x" } }));
    }
    return { mcpsDir, serversDir };
  }

  test("codex capture strips ai-kit-rendered MCP sections, keeps user config and hand-added servers", () => {
    writeMachine(
      "codex",
      "config.toml",
      `model = "gpt-5"
approval_policy = "on-request"

[mcp_servers.context7]
url = "https://mcp.context7.com"

[mcp_servers.myserver]
command = "bun"
args = ["run", "/x"]

[mcp_servers.myserver.env]
FOO = "bar"

[mcp_servers.custom]
command = "hand-added"
`,
    );

    configCapture("codex", { home, configDir, ...mcpSeams("context7", "myserver") });

    const captured = baseRead("codex", "config.toml");
    // ai-kit's own sections (names from mcps/) are gone.
    expect(captured).not.toContain("mcp_servers.context7");
    expect(captured).not.toContain("mcp_servers.myserver");
    expect(captured).not.toContain("FOO");
    // User config + hand-added server survive.
    expect(captured).toContain('model = "gpt-5"');
    expect(captured).toContain('approval_policy = "on-request"');
    expect(captured).toContain("[mcp_servers.custom]");
    expect(captured).toContain('command = "hand-added"');
  });

  test("opencode capture strips known MCP entries from the mcp key, keeps the rest", () => {
    writeMachine(
      "opencode",
      "opencode.json",
      JSON.stringify(
        {
          theme: "dark",
          mcp: {
            context7: { type: "remote", url: "https://mcp.context7.com" },
            custom: { type: "local", command: ["echo"] },
          },
        },
        null,
        2,
      ),
    );

    configCapture("opencode", { home, configDir, ...mcpSeams("context7") });

    const captured = JSON.parse(baseRead("opencode", "opencode.json"));
    expect(captured.mcp.context7).toBeUndefined();
    expect(captured.mcp.custom).toBeDefined();
    expect(captured.theme).toBe("dark");
    // 2-space indent + trailing newline, matching the installer.
    expect(baseRead("opencode", "opencode.json").endsWith("\n")).toBe(true);
  });

  test("placeholder-replacement warning fires when a repo ${VAR} becomes concrete; content is still concrete", () => {
    writeTracked("claude", "settings.json", '{"token":"${TEST_TOKEN}"}');
    writeMachine("claude", "settings.json", '{"token":"concrete-value"}');

    const logs = captureLogs(() => configCapture("claude", { home, configDir }));

    expect(logs.some((l) => l.includes("TEST_TOKEN"))).toBe(true);
    // Capture never reverse-substitutes: the concrete value is written.
    expect(baseRead("claude", "settings.json")).toBe('{"token":"concrete-value"}');
  });

  test("no placeholder warning when the repo copy had no placeholders", () => {
    writeTracked("claude", "settings.json", '{"model":"opus"}');
    writeMachine("claude", "settings.json", '{"model":"sonnet"}');

    const logs = captureLogs(() => configCapture("claude", { home, configDir }));

    expect(logs.some((l) => l.includes("re-placeholder"))).toBe(false);
    expect(baseRead("claude", "settings.json")).toBe('{"model":"sonnet"}');
  });

  test("no placeholder warning when there is no repo copy yet", () => {
    writeMachine("claude", "settings.json", '{"token":"concrete-value"}');

    const logs = captureLogs(() => configCapture("claude", { home, configDir }));

    expect(logs.some((l) => l.includes("re-placeholder"))).toBe(false);
  });

  /** Write a file into a machine's overlay tree (config/@<machine>/<target>/). */
  function writeOverlay(machine: string, target: string, relPath: string, content: string): void {
    const full = join(configDir, `@${machine}`, target, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }

  test("overlay-attribution warning names deep-merged keys and flags wholesale replacement", () => {
    writeMachine("claude", "settings.json", '{"other":1}');
    writeMachine("claude", "statusline-command.sh", "echo machine");
    writeOverlay("devmachine", "claude", "settings.json", '{"model":"local-opus"}');
    writeOverlay("devmachine", "claude", "statusline-command.sh", "echo local");

    const logs = captureLogs(() => configCapture("claude", { home, configDir, machine: "devmachine" }));

    // Deep-merged file: names the overlay's top-level key.
    expect(logs.some((l) => l.includes("settings.json") && l.includes("model"))).toBe(true);
    // Wholesale-replaced file: flagged as replaced.
    expect(logs.some((l) => l.includes("statusline-command.sh") && l.includes("replaces this file"))).toBe(true);
    // Base tree is written; no spurious file lands under the overlay dir.
    expect(baseExists("claude", "settings.json")).toBe(true);
    expect(existsSync(join(configDir, "@devmachine", "claude", "CLAUDE.md"))).toBe(false);
  });

  test("no overlay-attribution warning on a machine without an overlay dir", () => {
    writeMachine("claude", "settings.json", '{"model":"opus"}');
    writeOverlay("devmachine", "claude", "settings.json", '{"model":"local-opus"}');

    const logs = captureLogs(() => configCapture("claude", { home, configDir, machine: "othermachine" }));

    expect(logs.some((l) => l.includes("re-apply as an overlay"))).toBe(false);
  });

  /** Write the machine-owned manifest at the config-tree root. */
  function writeManifest(manifest: Record<string, Record<string, string[]>>): void {
    writeFileSync(join(configDir, "machine-owned.json"), JSON.stringify(manifest));
  }

  describe("machine-owned keys never cross into the repo", () => {
    test("an owned key that differs keeps the repo's value and says so", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeTracked("claude", "settings.json", '{"model":"repo-default","theme":"old"}');
      writeMachine("claude", "settings.json", '{"model":"machine-opus","theme":"new"}');

      const logs = captureLogs(() => configCapture("claude", { home, configDir }));

      const captured = JSON.parse(baseRead("claude", "settings.json"));
      expect(captured.model).toBe("repo-default");
      // Non-owned keys still come from the machine.
      expect(captured.theme).toBe("new");
      expect(logs.some((l) => l.includes("config/claude/settings.json") && l.includes('"model"'))).toBe(true);
    });

    test("an owned key present only on the machine is dropped, with a line naming it", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeTracked("claude", "settings.json", '{"theme":"old"}');
      writeMachine("claude", "settings.json", '{"model":"machine-opus","theme":"new"}');

      const logs = captureLogs(() => configCapture("claude", { home, configDir }));

      const captured = JSON.parse(baseRead("claude", "settings.json"));
      expect("model" in captured).toBe(false);
      expect(captured.theme).toBe("new");
      expect(
        logs.some((l) => l.includes("config/claude/settings.json") && l.includes("dropped") && l.includes('"model"')),
      ).toBe(true);
    });

    test("with no repo copy yet, every owned key drops and the rest is captured", () => {
      writeManifest({ claude: { "settings.json": ["model", "permissions"] } });
      writeMachine("claude", "settings.json", '{"model":"opus","permissions":{"allow":["x"]},"theme":"dark"}');

      configCapture("claude", { home, configDir });

      const captured = JSON.parse(baseRead("claude", "settings.json"));
      expect(captured).toEqual({ theme: "dark" });
    });

    test("an owned key the repo declares but the machine lacks survives capture", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeTracked("claude", "settings.json", '{"model":"repo-default"}');
      writeMachine("claude", "settings.json", '{"theme":"dark"}');

      configCapture("claude", { home, configDir });

      const captured = JSON.parse(baseRead("claude", "settings.json"));
      expect(captured.model).toBe("repo-default");
      expect(captured.theme).toBe("dark");
    });

    test("a corrupt machine file with owned keys warns and leaves the repo copy untouched", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeTracked("claude", "settings.json", '{"model":"repo-default"}');
      writeMachine("claude", "settings.json", "{not json");

      const logs = captureLogs(() => configCapture("claude", { home, configDir }));

      expect(baseRead("claude", "settings.json")).toBe('{"model":"repo-default"}');
      expect(logs.some((l) => l.includes("Skipped settings.json") && l.includes("leak"))).toBe(true);
    });

    test("a corrupt repo copy with owned keys warns and leaves it untouched", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeTracked("claude", "settings.json", "{not json");
      writeMachine("claude", "settings.json", '{"model":"machine-opus"}');

      const logs = captureLogs(() => configCapture("claude", { home, configDir }));

      expect(baseRead("claude", "settings.json")).toBe("{not json");
      expect(logs.some((l) => l.includes("Skipped settings.json"))).toBe(true);
    });

    test("an mcp-managed file gets both transforms: MCP sections stripped and owned keys at repo state", () => {
      writeManifest({ opencode: { "opencode.json": ["model"] } });
      writeTracked("opencode", "opencode.json", '{"model":"repo-default"}');
      writeMachine(
        "opencode",
        "opencode.json",
        JSON.stringify({
          model: "machine-model",
          theme: "dark",
          mcp: {
            context7: { type: "remote", url: "https://mcp.context7.com" },
            custom: { type: "local", command: ["echo"] },
          },
        }),
      );

      configCapture("opencode", { home, configDir, ...mcpSeams("context7") });

      const captured = JSON.parse(baseRead("opencode", "opencode.json"));
      expect(captured.mcp.context7).toBeUndefined();
      expect(captured.mcp.custom).toBeDefined();
      expect(captured.model).toBe("repo-default");
      expect(captured.theme).toBe("dark");
    });

    test("TOML: owned keys take repo state alongside an MCP strip", () => {
      writeManifest({ codex: { "config.toml": ["projects"] } });
      writeTracked("codex", "config.toml", '[projects."/repo/path"]\ntrust_level = "trusted"\n');
      writeMachine(
        "codex",
        "config.toml",
        `model = "gpt-5"

[projects."/machine/path"]
trust_level = "trusted"

[mcp_servers.context7]
url = "https://mcp.context7.com"
`,
      );

      const logs = captureLogs(() => configCapture("codex", { home, configDir, ...mcpSeams("context7") }));

      const captured = baseRead("codex", "config.toml");
      expect(captured).toContain('model = "gpt-5"');
      // The machine's trust entries never cross; the repo's stay.
      expect(captured).toContain("/repo/path");
      expect(captured).not.toContain("/machine/path");
      // MCP sections are stripped in the same pass.
      expect(captured).not.toContain("mcp_servers.context7");
      expect(logs.some((l) => l.includes("config/codex/config.toml") && l.includes('"projects"'))).toBe(true);
    });

    test("TOML: an owned key present only on the machine is dropped", () => {
      writeManifest({ codex: { "config.toml": ["projects"] } });
      writeTracked("codex", "config.toml", 'model = "gpt-5"\n');
      writeMachine("codex", "config.toml", 'model = "gpt-5"\n\n[projects."/machine/path"]\ntrust_level = "trusted"\n');

      configCapture("codex", { home, configDir });

      const captured = baseRead("codex", "config.toml");
      expect(captured).toContain('model = "gpt-5"');
      expect(captured).not.toContain("projects");
    });

    test("a file with no declared keys is captured byte-for-byte even when the manifest exists", () => {
      writeManifest({ claude: { "settings.json": ["model"] } });
      writeMachine("claude", "settings.json", '{"model":"opus"}');
      // Ugly formatting on an undeclared file: no parse, no re-stringify.
      writeMachine("claude", "CLAUDE.md", "# claude");
      writeTracked("claude", "other.json", "{}");
      writeMachine("claude", "other.json", '{ "a":1,   "b":2 }');

      configCapture("claude", { home, configDir });

      expect(baseRead("claude", "CLAUDE.md")).toBe("# claude");
      expect(baseRead("claude", "other.json")).toBe('{ "a":1,   "b":2 }');
    });

    test("with no manifest, a file that would be declared is captured raw", () => {
      writeTracked("claude", "settings.json", '{"model":"repo-default"}');
      writeMachine("claude", "settings.json", '{ "model":"machine-opus" }');

      configCapture("claude", { home, configDir });

      expect(baseRead("claude", "settings.json")).toBe('{ "model":"machine-opus" }');
    });

    test("a malformed manifest aborts the capture", () => {
      writeFileSync(join(configDir, "machine-owned.json"), "{not json");
      writeMachine("claude", "settings.json", '{"model":"opus"}');

      expect(() => configCapture("claude", { home, configDir })).toThrow(/machine-owned\.json/);
      expect(baseExists("claude", "settings.json")).toBe(false);
    });
  });
});
