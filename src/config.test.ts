import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { parseFrontmatter, loadSkillsFrom, loadMcpsFrom } from "./config";

// --- parseFrontmatter (pure) ---

describe("parseFrontmatter", () => {
  test("parses valid frontmatter with name and description", () => {
    const content = `---
name: code-review
description: Review code for quality
---
# Code Review

Steps here.`;

    const { data, body } = parseFrontmatter(content);
    expect(data.name).toBe("code-review");
    expect(data.description).toBe("Review code for quality");
    expect(body).toContain("# Code Review");
  });

  test("returns empty data and full content when no frontmatter", () => {
    const content = "# Just a heading\n\nSome body text.";
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });

  test("preserves colons in values", () => {
    const content = `---
description: Review code: quality, patterns, and issues
---
Body`;

    const { data } = parseFrontmatter(content);
    expect(data.description).toBe("Review code: quality, patterns, and issues");
  });

  test("handles empty body after frontmatter", () => {
    const content = `---
name: test
---
`;
    const { data, body } = parseFrontmatter(content);
    expect(data.name).toBe("test");
    expect(body).toBe("");
  });

  test("handles empty frontmatter block", () => {
    const content = `---

---
Body here`;
    const { data, body } = parseFrontmatter(content);
    expect(Object.keys(data)).toHaveLength(0);
    expect(body).toBe("Body here");
  });
});

// --- loadSkillsFrom (temp dir) ---

describe("loadSkillsFrom", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads skills from directory with SKILL.md files", () => {
    mkdirSync(join(tmpDir, "my-skill"), { recursive: true });
    writeFileSync(
      join(tmpDir, "my-skill", "SKILL.md"),
      `---
name: my-skill
description: A test skill
---
# My Skill`,
    );

    const skills = loadSkillsFrom(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].description).toBe("A test skill");
    expect(skills[0].source).toBeUndefined();
  });

  test("skips directories without SKILL.md", () => {
    mkdirSync(join(tmpDir, "empty-dir"), { recursive: true });
    mkdirSync(join(tmpDir, "valid-skill"), { recursive: true });
    writeFileSync(
      join(tmpDir, "valid-skill", "SKILL.md"),
      "---\nname: valid\n---\nBody",
    );

    const skills = loadSkillsFrom(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("valid");
  });

  test("loads source.json when present", () => {
    mkdirSync(join(tmpDir, "sourced"), { recursive: true });
    writeFileSync(
      join(tmpDir, "sourced", "SKILL.md"),
      "---\nname: sourced\n---\nBody",
    );
    writeFileSync(
      join(tmpDir, "sourced", "source.json"),
      JSON.stringify({
        from: "org/repo",
        skill: "sourced",
        fetchedAt: "2026-01-01T00:00:00Z",
      }),
    );

    const skills = loadSkillsFrom(tmpDir);
    expect(skills[0].source).toBeDefined();
    expect(skills[0].source!.from).toBe("org/repo");
  });

  test("returns empty array when directory does not exist", () => {
    const skills = loadSkillsFrom(join(tmpDir, "nonexistent"));
    expect(skills).toEqual([]);
  });

  test("falls back to directory name when frontmatter has no name", () => {
    mkdirSync(join(tmpDir, "dir-name"), { recursive: true });
    writeFileSync(
      join(tmpDir, "dir-name", "SKILL.md"),
      "---\ndescription: no name field\n---\nBody",
    );

    const skills = loadSkillsFrom(tmpDir);
    expect(skills[0].name).toBe("dir-name");
  });
});

// --- loadMcpsFrom (temp dir) ---

describe("loadMcpsFrom", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads MCP configs from JSON files", () => {
    writeFileSync(
      join(tmpDir, "playwright.json"),
      JSON.stringify({
        description: "Browser automation",
        config: { command: "npx", args: ["-y", "@anthropic/mcp-playwright"] },
      }),
    );

    const mcps = loadMcpsFrom(tmpDir);
    expect(mcps).toHaveLength(1);
    expect(mcps[0].name).toBe("playwright");
    expect(mcps[0].description).toBe("Browser automation");
    expect(mcps[0].config.command).toBe("npx");
  });

  test("skips non-JSON files", () => {
    writeFileSync(join(tmpDir, "readme.txt"), "not json");
    writeFileSync(
      join(tmpDir, "valid.json"),
      JSON.stringify({ description: "test", config: { command: "echo" } }),
    );

    const mcps = loadMcpsFrom(tmpDir);
    expect(mcps).toHaveLength(1);
    expect(mcps[0].name).toBe("valid");
  });

  test("returns empty array when directory does not exist", () => {
    const mcps = loadMcpsFrom(join(tmpDir, "nonexistent"));
    expect(mcps).toEqual([]);
  });
});
