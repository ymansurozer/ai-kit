import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  tomlString,
  buildTomlSection,
  removeTomlSection,
  installCodex,
} from "./codex";
import type { McpConfig, Skill } from "../config";

// --- tomlString (pure) ---

describe("tomlString", () => {
  test("wraps simple string in quotes", () => {
    expect(tomlString("hello")).toBe('"hello"');
  });

  test("escapes double quotes", () => {
    expect(tomlString('say "hi"')).toBe('"say \\"hi\\""');
  });

  test("escapes backslashes", () => {
    expect(tomlString("path\\to")).toBe('"path\\\\to"');
  });

  test("escapes backslash before quote", () => {
    expect(tomlString('a\\"b')).toBe('"a\\\\\\"b"');
  });
});

// --- buildTomlSection (pure) ---

describe("buildTomlSection", () => {
  test("builds section with command and args", () => {
    const mcp: McpConfig = {
      name: "playwright",
      description: "",
      config: { command: "npx", args: ["-y", "@anthropic/mcp-playwright"] },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toBe(
      `[mcp_servers.playwright]\ncommand = "npx"\nargs = ["-y", "@anthropic/mcp-playwright"]\n`,
    );
  });

  test("builds section with env sub-section", () => {
    const mcp: McpConfig = {
      name: "test",
      description: "",
      config: { command: "node", env: { API_KEY: "secret" } },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toContain("[mcp_servers.test]\n");
    expect(result).toContain('command = "node"\n');
    expect(result).toContain("[mcp_servers.test.env]\n");
    expect(result).toContain('API_KEY = "secret"\n');
  });

  test("builds section with command only (no args, no env)", () => {
    const mcp: McpConfig = {
      name: "simple",
      description: "",
      config: { command: "echo" },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toBe('[mcp_servers.simple]\ncommand = "echo"\n');
  });
});

// --- removeTomlSection (pure) ---

describe("removeTomlSection", () => {
  test("removes a section and its key-value lines", () => {
    const content = `[other]
key = "value"

[mcp_servers.playwright]
command = "npx"
args = ["-y", "pkg"]

[another]
x = 1`;

    const result = removeTomlSection(content, "mcp_servers.playwright");
    expect(result).toContain("[other]");
    expect(result).toContain("[another]");
    expect(result).not.toContain("mcp_servers.playwright");
    expect(result).not.toContain("npx");
  });

  test("removes section with sub-sections", () => {
    const content = `[mcp_servers.test]
command = "node"

[mcp_servers.test.env]
KEY = "val"

[other]
x = 1`;

    const result = removeTomlSection(content, "mcp_servers.test");
    expect(result).not.toContain("mcp_servers.test");
    expect(result).not.toContain("KEY");
    expect(result).toContain("[other]");
  });

  test("leaves content unchanged if section not found", () => {
    const content = `[mcp_servers.other]
command = "echo"`;

    const result = removeTomlSection(content, "mcp_servers.missing");
    expect(result).toBe(content);
  });

  test("handles empty content", () => {
    expect(removeTomlSection("", "mcp_servers.test")).toBe("");
  });
});

// --- installCodex per-repo (temp dir) ---

describe("installCodex per-repo", () => {
  let tmpDir: string;
  let skillDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-test-"));
    skillDir = mkdtempSync(join(tmpdir(), "ai-kit-skills-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  });

  function makeSkill(name: string): Skill {
    const path = join(skillDir, `${name}.md`);
    writeFileSync(path, `---\nname: ${name}\n---\n# ${name}`);
    return { name, description: "", body: `# ${name}`, path };
  }

  function makeMcp(name: string): McpConfig {
    return {
      name,
      description: "",
      config: { command: "npx", args: ["-y", `@test/${name}`] },
      path: "",
    };
  }

  test("copies skills to .agents/skills/", () => {
    installCodex([makeSkill("review")], [], false, tmpDir);
    const dest = join(tmpDir, ".agents", "skills", "review", "SKILL.md");
    expect(readFileSync(dest, "utf-8")).toContain("# review");
  });

  test("creates TOML config for MCPs", () => {
    installCodex([], [makeMcp("playwright")], false, tmpDir);
    const toml = readFileSync(
      join(tmpDir, ".codex", "config.toml"),
      "utf-8",
    );
    expect(toml).toContain("[mcp_servers.playwright]");
    expect(toml).toContain('"npx"');
  });

  test("merges MCPs into existing TOML without clobbering", () => {
    const configDir = join(tmpDir, ".codex");
    const { mkdirSync: mk } = require("fs");
    mk(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
      '[settings]\nmodel = "gpt-4"\n',
    );

    installCodex([], [makeMcp("new-server")], false, tmpDir);
    const toml = readFileSync(join(configDir, "config.toml"), "utf-8");
    expect(toml).toContain("[settings]");
    expect(toml).toContain("[mcp_servers.new-server]");
  });

  test("replaces existing MCP section on re-install", () => {
    installCodex([], [makeMcp("pw")], false, tmpDir);
    installCodex([], [makeMcp("pw")], false, tmpDir);

    const toml = readFileSync(
      join(tmpDir, ".codex", "config.toml"),
      "utf-8",
    );
    const matches = toml.match(/\[mcp_servers\.pw\]/g);
    expect(matches).toHaveLength(1);
  });
});
