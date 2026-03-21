import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseFrontmatter,
  loadSkillsFrom,
  loadMcpsFrom,
  loadServersFrom,
  extractEnvVar,
  extractBearerTokenEnvVar,
  transformEnvVars,
  containsEnvPlaceholderSyntax,
} from "./config";

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

// --- env placeholder helpers (pure) ---

describe("env placeholder helpers", () => {
  test("extracts exact env placeholders", () => {
    expect(extractEnvVar("${API_KEY}")).toBe("API_KEY");
    expect(extractEnvVar("prefix-${API_KEY}")).toBeNull();
  });

  test("extracts bearer token env placeholders", () => {
    expect(extractBearerTokenEnvVar("Bearer ${SERVICE_API_TOKEN}")).toBe("SERVICE_API_TOKEN");
    expect(extractBearerTokenEnvVar("${SERVICE_API_TOKEN}")).toBeNull();
  });

  test("detects placeholder syntax in strings", () => {
    expect(containsEnvPlaceholderSyntax("prefix-${TOKEN}")).toBe(true);
    expect(containsEnvPlaceholderSyntax("literal")).toBe(false);
  });

  test("transforms exact and bearer placeholders recursively", () => {
    const input = {
      env: {
        API_KEY: "${API_KEY}",
      },
      headers: {
        Authorization: "Bearer ${SERVICE_API_TOKEN}",
      },
      args: ["--flag", "${VALUE}", "literal"],
    };

    const result = transformEnvVars(input, (varName) => `{env:${varName}}`);
    expect(result).toEqual({
      env: {
        API_KEY: "{env:API_KEY}",
      },
      headers: {
        Authorization: "Bearer {env:SERVICE_API_TOKEN}",
      },
      args: ["--flag", "{env:VALUE}", "literal"],
    });
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

  test("loads HTTP MCP configs from JSON files", () => {
    writeFileSync(
      join(tmpDir, "docs-search.json"),
      JSON.stringify({
        description: "Docs search",
        config: { url: "https://mcp.example.com/docs" },
      }),
    );

    const mcps = loadMcpsFrom(tmpDir);
    expect(mcps).toHaveLength(1);
    expect(mcps[0].name).toBe("docs-search");
    expect(mcps[0].config.url).toBe("https://mcp.example.com/docs");
  });

  test("loads placeholder-bearing MCP configs without resolving them", () => {
    writeFileSync(
      join(tmpDir, "analytics.json"),
      JSON.stringify({
        description: "Analytics",
        config: {
          url: "https://mcp.example.com/analytics",
          headers: {
            Authorization: "Bearer ${ANALYTICS_AUTH_TOKEN}",
          },
        },
      }),
    );

    const mcps = loadMcpsFrom(tmpDir);
    expect(mcps).toHaveLength(1);
    expect((mcps[0].config.headers as Record<string, string>).Authorization).toBe(
      "Bearer ${ANALYTICS_AUTH_TOKEN}",
    );
  });

  test("loads stdio placeholder-bearing MCP configs without resolving them", () => {
    writeFileSync(
      join(tmpDir, "search-service.json"),
      JSON.stringify({
        description: "Search service",
        config: {
          command: "npx",
          args: ["-y", "example-mcp-server"],
          env: {
            SERVICE_USERNAME: "${SERVICE_USERNAME}",
          },
        },
      }),
    );

    const mcps = loadMcpsFrom(tmpDir);
    expect(mcps).toHaveLength(1);
    expect((mcps[0].config.env as Record<string, string>).SERVICE_USERNAME).toBe(
      "${SERVICE_USERNAME}",
    );
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

// --- loadServersFrom (temp dir) ---

describe("loadServersFrom", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads server with index.ts and server.json", () => {
    mkdirSync(join(tmpDir, "my-server"), { recursive: true });
    writeFileSync(join(tmpDir, "my-server", "index.ts"), "// server code");
    writeFileSync(
      join(tmpDir, "my-server", "server.json"),
      JSON.stringify({ description: "My server" }),
    );

    const servers = loadServersFrom(tmpDir);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("my-server");
    expect(servers[0].description).toBe("My server");
    expect(servers[0].config.command).toBe("bun");
    expect(servers[0].config.args).toEqual([
      "run",
      join(tmpDir, "my-server", "index.ts"),
    ]);
    expect(servers[0].isLocal).toBe(true);
  });

  test("skips directories without index.ts", () => {
    mkdirSync(join(tmpDir, "no-entry"), { recursive: true });
    writeFileSync(
      join(tmpDir, "no-entry", "server.json"),
      JSON.stringify({ description: "missing entry" }),
    );

    const servers = loadServersFrom(tmpDir);
    expect(servers).toEqual([]);
  });

  test("returns empty array when directory does not exist", () => {
    const servers = loadServersFrom(join(tmpDir, "nonexistent"));
    expect(servers).toEqual([]);
  });

  test("includes env from server.json in config", () => {
    mkdirSync(join(tmpDir, "with-env"), { recursive: true });
    writeFileSync(join(tmpDir, "with-env", "index.ts"), "// server code");
    writeFileSync(
      join(tmpDir, "with-env", "server.json"),
      JSON.stringify({
        description: "Has env",
        env: { API_KEY: "test-key" },
      }),
    );

    const servers = loadServersFrom(tmpDir);
    expect(servers[0].config.env).toEqual({ API_KEY: "test-key" });
  });

  test("works without server.json", () => {
    mkdirSync(join(tmpDir, "bare"), { recursive: true });
    writeFileSync(join(tmpDir, "bare", "index.ts"), "// server code");

    const servers = loadServersFrom(tmpDir);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("bare");
    expect(servers[0].description).toBe("");
  });
});
