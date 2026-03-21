import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
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

  test("moves exact env placeholders into env_vars", () => {
    const mcp: McpConfig = {
      name: "search-service",
      description: "",
      config: {
        command: "npx",
        args: ["-y", "example-mcp-server"],
        env: {
          SERVICE_USERNAME: "${SERVICE_USERNAME}",
          SERVICE_PASSWORD: "${SERVICE_PASSWORD}",
        },
      },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toContain(
      'env_vars = ["SERVICE_USERNAME", "SERVICE_PASSWORD"]\n',
    );
    expect(result).not.toContain("[mcp_servers.search-service.env]");
  });

  test("splits static env values from forwarded env_vars", () => {
    const mcp: McpConfig = {
      name: "credentials-file",
      description: "",
      config: {
        command: "npx",
        args: ["-y", "example-file-mcp"],
        env: {
          CREDENTIALS_FILE: "${CREDENTIALS_FILE}",
          NODE_ENV: "production",
        },
      },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toContain('env_vars = ["CREDENTIALS_FILE"]\n');
    expect(result).toContain("[mcp_servers.credentials-file.env]\n");
    expect(result).toContain('NODE_ENV = "production"\n');
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

  test("builds section with remote MCP url", () => {
    const mcp: McpConfig = {
      name: "docs-search",
      description: "",
      config: { url: "https://mcp.example.com/docs" },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toBe(
      '[mcp_servers.docs-search]\nurl = "https://mcp.example.com/docs"\n',
    );
  });

  test("moves remote env-backed headers into env_http_headers", () => {
    const mcp: McpConfig = {
      name: "docs-search",
      description: "",
      config: {
        url: "https://mcp.example.com/docs",
        headers: {
          X_API_KEY: "${DOCS_API_KEY}",
        },
      },
      path: "",
    };

    const result = buildTomlSection(mcp);
    expect(result).toContain("[mcp_servers.docs-search.env_http_headers]\n");
    expect(result).toContain('X_API_KEY = "DOCS_API_KEY"\n');
  });

  test("converts bearer placeholders to bearer_token_env_var", () => {
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

    const result = buildTomlSection(mcp);
    expect(result).toContain('bearer_token_env_var = "ANALYTICS_AUTH_TOKEN"\n');
    expect(result).not.toContain("http_headers");
  });

  test("throws for unsupported interpolation", () => {
    const mcp: McpConfig = {
      name: "bad",
      description: "",
      config: {
        command: "npx",
        args: ["prefix-${TOKEN}"],
      },
      path: "",
    };

    expect(() => buildTomlSection(mcp)).toThrow(
      "Unsupported MCP config for bad: args[0] uses unsupported placeholder interpolation",
    );
  });

  test("throws when forwarded env var name does not match target key", () => {
    const mcp: McpConfig = {
      name: "bad-alias",
      description: "",
      config: {
        command: "npx",
        env: {
          API_KEY: "${OTHER_KEY}",
        },
      },
      path: "",
    };

    expect(() => buildTomlSection(mcp)).toThrow(
      "Unsupported MCP config for bad-alias: env.API_KEY references OTHER_KEY",
    );
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

  test("removes sections whose headers include inline comments", () => {
    const content = `[mcp_servers.playwright] # local note
command = "npx"

[other]
key = "value"`;

    const result = removeTomlSection(content, "mcp_servers.playwright");
    expect(result).not.toContain("mcp_servers.playwright");
    expect(result).toContain("[other]");
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
    mkdirSync(configDir, { recursive: true });
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

  test("replaces sections whose headers include inline comments", () => {
    const configDir = join(tmpDir, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
      `[mcp_servers.playwright] # local note
command = "old"

[features]
multi_agent = true
`,
    );

    installCodex([], [makeMcp("playwright")], false, tmpDir);
    const toml = readFileSync(join(configDir, "config.toml"), "utf-8");
    const matches = toml.match(/\[mcp_servers\.playwright\]/g);
    expect(matches).toHaveLength(1);
    expect(toml).toContain('command = "npx"');
    expect(toml).not.toContain('command = "old"');
  });

  test("writes bearer token indirection for remote auth without embedding secrets", () => {
    const mcp: McpConfig = {
      name: "analytics",
      description: "",
      config: {
        url: "https://mcp.example.com/analytics",
        headers: {
          Authorization: "Bearer ${ANALYTICS_API_TOKEN}",
        },
      },
      path: "",
    };

    installCodex([], [mcp], false, tmpDir);
    const toml = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain('bearer_token_env_var = "ANALYTICS_API_TOKEN"');
    expect(toml).not.toContain("Bearer ${ANALYTICS_API_TOKEN}");
  });

  test("preserves unrelated keys inside an existing MCP section", () => {
    const configDir = join(tmpDir, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
      `[mcp_servers.playwright]
enabled = false
timeout = 30
command = "old"
args = ["--old"]

[mcp_servers.playwright.custom]
note = "keep"

[features]
multi_agent = true
`,
    );

    installCodex([], [makeMcp("playwright")], false, tmpDir);
    const toml = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain("[features]");
    expect(toml).toContain("multi_agent = true");
    expect(toml).toContain("[mcp_servers.playwright]");
    expect(toml).toContain("enabled = false");
    expect(toml).toContain("timeout = 30");
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain('args = ["-y", "@test/playwright"]');
    expect(toml).toContain("[mcp_servers.playwright.custom]");
    expect(toml).toContain('note = "keep"');
    expect(toml).not.toContain('args = ["--old"]');
  });

  test("replaces owned subsections while preserving unrelated ones", () => {
    const configDir = join(tmpDir, ".codex");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
      `[mcp_servers.analytics]
enabled = true
url = "https://old.example.com"

[mcp_servers.analytics.http_headers]
Authorization = "old"
X_OLD = "remove-me"

[mcp_servers.analytics.custom]
note = "keep"
`,
    );

    const mcp: McpConfig = {
      name: "analytics",
      description: "",
      config: {
        url: "https://mcp.example.com/analytics",
        headers: {
          Authorization: "Bearer ${ANALYTICS_API_TOKEN}",
        },
      },
      path: "",
    };

    installCodex([], [mcp], false, tmpDir);
    const toml = readFileSync(join(configDir, "config.toml"), "utf-8");
    expect(toml).toContain('url = "https://mcp.example.com/analytics"');
    expect(toml).toContain('bearer_token_env_var = "ANALYTICS_API_TOKEN"');
    expect(toml).toContain("enabled = true");
    expect(toml).toContain("[mcp_servers.analytics.custom]");
    expect(toml).toContain('note = "keep"');
    expect(toml).not.toContain("[mcp_servers.analytics.http_headers]");
    expect(toml).not.toContain("X_OLD");
  });
});
