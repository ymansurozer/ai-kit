import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { convertMcpConfig, installOpencode } from "./opencode";
import type { McpConfig, Skill } from "../config";

// --- convertMcpConfig (pure) ---

describe("convertMcpConfig", () => {
  test("converts command + args to array format", () => {
    const mcp: McpConfig = {
      name: "playwright",
      description: "",
      config: { command: "npx", args: ["-y", "@playwright/mcp"] },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.type).toBe("local");
    expect(result.command).toEqual(["npx", "-y", "@playwright/mcp"]);
  });

  test("converts command-only to single-element array", () => {
    const mcp: McpConfig = {
      name: "simple",
      description: "",
      config: { command: "echo" },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.command).toEqual(["echo"]);
  });

  test("converts env to environment", () => {
    const mcp: McpConfig = {
      name: "test",
      description: "",
      config: { command: "node", env: { API_KEY: "secret", PORT: "3000" } },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.environment).toEqual({ API_KEY: "secret", PORT: "3000" });
  });

  test("omits environment when no env", () => {
    const mcp: McpConfig = {
      name: "test",
      description: "",
      config: { command: "node" },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.environment).toBeUndefined();
  });
});

// --- installOpencode per-repo (temp dir) ---

describe("installOpencode per-repo", () => {
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

  test("copies skills to .opencode/skills/", () => {
    installOpencode([makeSkill("review")], [], false, tmpDir);
    const dest = join(tmpDir, ".opencode", "skills", "review", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf-8")).toContain("# review");
  });

  test("creates opencode.json with mcp section", () => {
    installOpencode([], [makeMcp("playwright")], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.mcp.playwright).toBeDefined();
    expect(config.mcp.playwright.type).toBe("local");
    expect(config.mcp.playwright.command).toEqual(["npx", "-y", "@test/playwright"]);
  });

  test("merges MCPs into existing opencode.json", () => {
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: { existing: { type: "local", command: ["echo"] } },
      }),
    );

    installOpencode([], [makeMcp("new-one")], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.mcp.existing).toBeDefined();
    expect(config.mcp["new-one"]).toBeDefined();
  });

  test("preserves non-mcp keys in opencode.json", () => {
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({ theme: "dark", mcp: {} }),
    );

    installOpencode([], [makeMcp("test")], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.theme).toBe("dark");
  });

  test("converts env to environment in output", () => {
    const mcp: McpConfig = {
      name: "with-env",
      description: "",
      config: { command: "node", args: ["server.js"], env: { KEY: "val" } },
      path: "",
    };

    installOpencode([], [mcp], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.mcp["with-env"].environment).toEqual({ KEY: "val" });
    expect(config.mcp["with-env"].command).toEqual(["node", "server.js"]);
  });

  test("skips MCP install when no MCPs provided", () => {
    installOpencode([makeSkill("s")], [], false, tmpDir);
    expect(existsSync(join(tmpDir, "opencode.json"))).toBe(false);
  });
});
