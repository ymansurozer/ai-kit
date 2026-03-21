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

  test("converts exact env placeholders to OpenCode syntax", () => {
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

    const result = convertMcpConfig(mcp);
    expect(result.environment).toEqual({
      SERVICE_USERNAME: "{env:SERVICE_USERNAME}",
    });
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

  test("converts url config to remote MCP", () => {
    const mcp: McpConfig = {
      name: "docs-search",
      description: "",
      config: {
        url: "https://mcp.example.com/docs",
        headers: { Authorization: "Bearer token" },
      },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.type).toBe("remote");
    expect(result.url).toBe("https://mcp.example.com/docs");
    expect(result.headers).toEqual({ Authorization: "Bearer token" });
  });

  test("converts remote placeholders to OpenCode syntax", () => {
    const mcp: McpConfig = {
      name: "analytics",
      description: "",
      config: {
        url: "https://mcp.example.com/analytics",
        headers: {
          Authorization: "Bearer ${ANALYTICS_AUTH_TOKEN}",
          X_API_KEY: "${DOCS_API_KEY}",
        },
      },
      path: "",
    };

    const result = convertMcpConfig(mcp);
    expect(result.type).toBe("remote");
    expect(result.headers).toEqual({
      Authorization: "Bearer {env:ANALYTICS_AUTH_TOKEN}",
      X_API_KEY: "{env:DOCS_API_KEY}",
    });
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

  test("preserves unrelated keys inside an existing MCP entry", () => {
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          playwright: {
            type: "local",
            command: ["old", "--flag"],
            environment: {
              SERVICE_USERNAME: "old-user",
              LOCAL_ONLY: "keep",
            },
            enabled: false,
          },
        },
      }),
    );

    const mcp: McpConfig = {
      name: "playwright",
      description: "",
      config: {
        command: "npx",
        args: ["-y", "@playwright/mcp"],
        env: {
          SERVICE_USERNAME: "${SERVICE_USERNAME}",
        },
      },
      path: "",
    };

    installOpencode([], [mcp], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.mcp.playwright.command).toEqual(["npx", "-y", "@playwright/mcp"]);
    expect(config.mcp.playwright.environment).toEqual({
      SERVICE_USERNAME: "{env:SERVICE_USERNAME}",
    });
    expect(config.mcp.playwright.enabled).toBe(false);
  });

  test("replaces owned nested keys when reinstalling an MCP entry", () => {
    writeFileSync(
      join(tmpDir, "opencode.json"),
      JSON.stringify({
        mcp: {
          analytics: {
            type: "remote",
            url: "https://old.example.com",
            headers: {
              Authorization: "Bearer old-token",
              X_OLD: "remove-me",
            },
            environment: {
              API_KEY: "old-key",
            },
            enabled: false,
          },
        },
      }),
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

    installOpencode([], [mcp], false, tmpDir);
    const config = JSON.parse(
      readFileSync(join(tmpDir, "opencode.json"), "utf-8"),
    );
    expect(config.mcp.analytics.url).toBe("https://mcp.example.com/analytics");
    expect(config.mcp.analytics.headers).toEqual({
      Authorization: "Bearer {env:ANALYTICS_API_TOKEN}",
    });
    expect(config.mcp.analytics.environment).toBeUndefined();
    expect(config.mcp.analytics.enabled).toBe(false);
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

  test("writes placeholder-based remote auth without embedding secrets", () => {
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

    installOpencode([], [mcp], false, tmpDir);
    const raw = readFileSync(join(tmpDir, "opencode.json"), "utf-8");
    const config = JSON.parse(raw);
    expect(config.mcp.analytics.headers.Authorization).toBe(
      "Bearer {env:ANALYTICS_API_TOKEN}",
    );
    expect(raw).not.toContain("Bearer ${ANALYTICS_API_TOKEN}");
  });

  test("skips MCP install when no MCPs provided", () => {
    installOpencode([makeSkill("s")], [], false, tmpDir);
    expect(existsSync(join(tmpDir, "opencode.json"))).toBe(false);
  });
});
