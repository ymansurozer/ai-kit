import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { convertSkillToCommand, installClaude } from "./claude";
import type { McpConfig, Skill } from "../config";

// --- convertSkillToCommand (pure) ---

describe("convertSkillToCommand", () => {
  test("strips name from frontmatter, keeps description", () => {
    const input = `---
name: code-review
description: Review code for quality
---
# Code Review`;

    const output = convertSkillToCommand(input);
    expect(output).toBe(`---
description: Review code for quality
---
# Code Review`);
  });

  test("returns body only when name is the only frontmatter field", () => {
    const input = `---
name: solo
---
Just the body.`;

    const output = convertSkillToCommand(input);
    expect(output).toBe("Just the body.");
  });

  test("preserves multiple non-name fields", () => {
    const input = `---
name: test
description: A test
version: 1.0
---
Body`;

    const output = convertSkillToCommand(input);
    expect(output).toContain("description: A test");
    expect(output).toContain("version: 1.0");
    expect(output).not.toContain("name:");
  });

  test("handles content with no frontmatter", () => {
    const input = "# Just markdown\n\nNo frontmatter.";
    const output = convertSkillToCommand(input);
    expect(output).toBe(input);
  });

  test("handles CRLF frontmatter without keeping the name field", () => {
    const input = "---\r\nname: windows-skill\r\ndescription: Works on CRLF\r\n---\r\n# Body";

    const output = convertSkillToCommand(input);
    expect(output).toBe(`---
description: Works on CRLF
---
# Body`);
  });
});

// --- installClaude per-repo (temp dir) ---

describe("installClaude per-repo", () => {
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
    installClaude([makeSkill("review")], [], false, tmpDir);
    const dest = join(tmpDir, ".agents", "skills", "review", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf-8")).toContain("# review");
  });

  test("creates .mcp.json with mcpServers", () => {
    installClaude([], [makeMcp("playwright")], false, tmpDir);
    const mcpJson = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(mcpJson.mcpServers.playwright).toBeDefined();
    expect(mcpJson.mcpServers.playwright.command).toBe("npx");
  });

  test("preserves exact env placeholders for Claude", () => {
    const mcp: McpConfig = {
      name: "search-service",
      description: "",
      config: {
        command: "npx",
        args: ["-y", "example-mcp-server"],
        env: {
          SERVICE_USERNAME: "${SERVICE_USERNAME}",
        },
      },
      path: "",
    };

    installClaude([], [mcp], false, tmpDir);
    const mcpJson = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(mcpJson.mcpServers["search-service"].env.SERVICE_USERNAME).toBe(
      "${SERVICE_USERNAME}",
    );
  });

  test("preserves HTTP MCP placeholders for Claude", () => {
    const mcp: McpConfig = {
      name: "analytics",
      description: "",
      config: {
        url: "https://mcp.example.com/analytics",
        headers: {
          Authorization: "Bearer ${ANALYTICS_AUTH_TOKEN}",
        },
      },
      path: "",
    };

    installClaude([], [mcp], false, tmpDir);
    const mcpJson = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(mcpJson.mcpServers.analytics.headers.Authorization).toBe(
      "Bearer ${ANALYTICS_AUTH_TOKEN}",
    );
  });

  test("merges MCPs into existing .mcp.json", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { existing: { command: "echo" } },
      }),
    );

    installClaude([], [makeMcp("new-one")], false, tmpDir);
    const mcpJson = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(mcpJson.mcpServers.existing).toBeDefined();
    expect(mcpJson.mcpServers["new-one"]).toBeDefined();
  });

  test("preserves non-mcpServers keys in .mcp.json", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ customKey: true, mcpServers: {} }),
    );

    installClaude([], [makeMcp("test")], false, tmpDir);
    const mcpJson = JSON.parse(
      readFileSync(join(tmpDir, ".mcp.json"), "utf-8"),
    );
    expect(mcpJson.customKey).toBe(true);
  });

  test("skips MCP install when no MCPs provided", () => {
    installClaude([makeSkill("s")], [], false, tmpDir);
    expect(existsSync(join(tmpDir, ".mcp.json"))).toBe(false);
  });
});
