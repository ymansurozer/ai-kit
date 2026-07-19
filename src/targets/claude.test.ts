import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import type { McpConfig, Skill } from "../config";
import { installClaude } from "./claude";

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

  function makeSkill(
    name: string,
    opts?: {
      references?: Record<string, string>;
      siblings?: Record<string, string>;
      withSourceJson?: boolean;
    },
  ): Skill {
    const dir = join(skillDir, name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(path, `---\nname: ${name}\n---\n# ${name}`);
    if (opts?.references) {
      const refsDir = join(dir, "references");
      mkdirSync(refsDir, { recursive: true });
      for (const [file, content] of Object.entries(opts.references)) {
        writeFileSync(join(refsDir, file), content);
      }
    }
    if (opts?.siblings) {
      for (const [file, content] of Object.entries(opts.siblings)) {
        writeFileSync(join(dir, file), content);
      }
    }
    if (opts?.withSourceJson) {
      writeFileSync(join(dir, "source.json"), JSON.stringify({ from: "x/y", skill: name, fetchedAt: "2026-01-01" }));
    }
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

  test("copies skill references/ to .agents/skills/", () => {
    const skill = makeSkill("ymo", {
      references: { "writing-voice.md": "# Writing Voice\nBe direct." },
    });
    installClaude([skill], [], false, tmpDir);
    const refDest = join(tmpDir, ".agents", "skills", "ymo", "references", "writing-voice.md");
    expect(existsSync(refDest)).toBe(true);
    expect(readFileSync(refDest, "utf-8")).toContain("Be direct.");
  });

  test("copies sibling asset files alongside SKILL.md (per-repo)", () => {
    const skill = makeSkill("prototype", {
      siblings: {
        "LOGIC.md": "# Logic branch",
        "UI.md": "# UI branch",
      },
    });
    installClaude([skill], [], false, tmpDir);
    const base = join(tmpDir, ".agents", "skills", "prototype");
    expect(readFileSync(join(base, "LOGIC.md"), "utf-8")).toContain("Logic branch");
    expect(readFileSync(join(base, "UI.md"), "utf-8")).toContain("UI branch");
  });

  test("does not copy source.json into install destination (per-repo)", () => {
    const skill = makeSkill("fetched", { withSourceJson: true });
    installClaude([skill], [], false, tmpDir);
    const dest = join(tmpDir, ".agents", "skills", "fetched", "source.json");
    expect(existsSync(dest)).toBe(false);
  });

  test("creates .mcp.json with mcpServers", () => {
    installClaude([], [makeMcp("playwright")], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.playwright).toBeDefined();
    expect(mcpJson.mcpServers.playwright.command).toBe("npx");
    expect(mcpJson.mcpServers.playwright.type).toBe("stdio");
  });

  test("sets type=http for HTTP MCPs in .mcp.json", () => {
    const mcp: McpConfig = {
      name: "analytics",
      description: "",
      config: {
        url: "https://mcp.example.com/analytics",
      },
      path: "",
    };
    installClaude([], [mcp], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.analytics.type).toBe("http");
    expect(mcpJson.mcpServers.analytics.url).toBe("https://mcp.example.com/analytics");
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
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["search-service"].env.SERVICE_USERNAME).toBe("${SERVICE_USERNAME}");
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
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.analytics.headers.Authorization).toBe("Bearer ${ANALYTICS_AUTH_TOKEN}");
  });

  test("merges MCPs into existing .mcp.json", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: { existing: { command: "echo" } },
      }),
    );

    installClaude([], [makeMcp("new-one")], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.existing).toBeDefined();
    expect(mcpJson.mcpServers["new-one"]).toBeDefined();
  });

  test("preserves unrelated keys inside an existing MCP entry", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          playwright: {
            command: "old",
            args: ["--old"],
            env: {
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

    installClaude([], [mcp], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.playwright.command).toBe("npx");
    expect(mcpJson.mcpServers.playwright.args).toEqual(["-y", "@playwright/mcp"]);
    expect(mcpJson.mcpServers.playwright.env).toEqual({
      SERVICE_USERNAME: "${SERVICE_USERNAME}",
    });
    expect(mcpJson.mcpServers.playwright.enabled).toBe(false);
  });

  test("replaces owned nested keys when reinstalling an MCP entry", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          analytics: {
            headers: {
              Authorization: "Bearer old-token",
              X_OLD: "remove-me",
            },
            env: {
              API_KEY: "old-key",
              LOCAL_ONLY: "remove-me",
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
          Authorization: "Bearer ${ANALYTICS_AUTH_TOKEN}",
        },
      },
      path: "",
    };

    installClaude([], [mcp], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers.analytics.headers).toEqual({
      Authorization: "Bearer ${ANALYTICS_AUTH_TOKEN}",
    });
    expect(mcpJson.mcpServers.analytics.env).toBeUndefined();
    expect(mcpJson.mcpServers.analytics.enabled).toBe(false);
  });

  test("preserves non-mcpServers keys in .mcp.json", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), JSON.stringify({ customKey: true, mcpServers: {} }));

    installClaude([], [makeMcp("test")], false, tmpDir);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.customKey).toBe(true);
  });

  test("skips MCP install when no MCPs provided", () => {
    installClaude([makeSkill("s")], [], false, tmpDir);
    expect(existsSync(join(tmpDir, ".mcp.json"))).toBe(false);
  });
});

// --- installClaude global (subprocess with HOME override) ---
//
// installClaude's global branch resolves paths through homedir(), so it must run
// in a subprocess whose HOME points at a temp dir (same pattern as install.test.ts).

describe("installClaude global", () => {
  const claudeUrl = pathToFileURL(join(import.meta.dir, "claude.ts")).href;

  let homeDir: string;
  let skillDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-home-"));
    skillDir = mkdtempSync(join(tmpdir(), "ai-kit-gskills-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
  });

  function makeSkill(
    name: string,
    opts?: { references?: Record<string, string>; siblings?: Record<string, string> },
  ): Skill {
    const dir = join(skillDir, name);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    writeFileSync(path, `---\nname: ${name}\ndescription: A ${name} skill\n---\n# ${name}`);
    if (opts?.references) {
      const refsDir = join(dir, "references");
      mkdirSync(refsDir, { recursive: true });
      for (const [file, content] of Object.entries(opts.references)) {
        writeFileSync(join(refsDir, file), content);
      }
    }
    if (opts?.siblings) {
      for (const [file, content] of Object.entries(opts.siblings)) {
        writeFileSync(join(dir, file), content);
      }
    }
    return { name, description: "", body: `# ${name}`, path };
  }

  function runInstall(skills: Skill[]): ReturnType<typeof spawnSync> {
    const script = `
      import { installClaude } from ${JSON.stringify(claudeUrl)};
      installClaude(${JSON.stringify(skills)}, [], true, ${JSON.stringify(homeDir)});
    `;
    return spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });
  }

  test("installs skills to ~/.claude/skills/<name>/ with frontmatter intact, nothing in commands/", () => {
    const skill = makeSkill("review", {
      siblings: { "helper.md": "# helper" },
      references: { "ref.md": "# ref" },
    });

    const result = runInstall([skill]);
    expect(result.status).toBe(0);

    const skillMd = join(homeDir, ".claude", "skills", "review", "SKILL.md");
    expect(existsSync(skillMd)).toBe(true);
    const content = readFileSync(skillMd, "utf-8");
    expect(content).toContain("name: review");
    expect(content).toContain("# review");

    expect(existsSync(join(homeDir, ".claude", "skills", "review", "helper.md"))).toBe(true);
    expect(existsSync(join(homeDir, ".claude", "skills", "review", "references", "ref.md"))).toBe(true);

    expect(existsSync(join(homeDir, ".claude", "commands"))).toBe(false);
  });

  test("removes old command-layout leftovers, keeps hand-written commands, idempotent", () => {
    const skill = makeSkill("proto", {
      siblings: { "asset.md": "flat asset" },
      references: { "r.md": "ref" },
    });

    const commandsDir = join(homeDir, ".claude", "commands");
    mkdirSync(join(commandsDir, "references"), { recursive: true });
    writeFileSync(join(commandsDir, "proto.md"), "old converted command");
    writeFileSync(join(commandsDir, "asset.md"), "flat asset copy");
    writeFileSync(join(commandsDir, "references", "r.md"), "ref copy");
    writeFileSync(join(commandsDir, "my-command.md"), "hand written");

    const result = runInstall([skill]);
    expect(result.status).toBe(0);

    expect(existsSync(join(commandsDir, "proto.md"))).toBe(false);
    expect(existsSync(join(commandsDir, "asset.md"))).toBe(false);
    expect(existsSync(join(commandsDir, "references"))).toBe(false);
    expect(existsSync(join(commandsDir, "my-command.md"))).toBe(true);

    // Second run: no error, hand-written command still present.
    const again = runInstall([skill]);
    expect(again.status).toBe(0);
    expect(existsSync(join(commandsDir, "my-command.md"))).toBe(true);
    expect(existsSync(join(commandsDir, "proto.md"))).toBe(false);
  });
});
