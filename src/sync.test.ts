import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

const repoRoot = join(import.meta.dir, "..");
const syncUrl = pathToFileURL(join(repoRoot, "src", "sync.ts")).href;

describe("sync", () => {
  let homeDir: string;
  let projectDir: string;
  let selectedSkillName: string;
  let extraSkillName: string;
  let selectedMcpName: string;
  let extraMcpName: string;
  let selectedSkillDir: string;
  let extraSkillDir: string;
  let selectedMcpPath: string;
  let extraMcpPath: string;

  beforeEach(() => {
    const suffix = `${process.pid}-${Date.now()}`;
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "ai-kit-project-"));
    selectedSkillName = `selected-skill-${suffix}`;
    extraSkillName = `extra-skill-${suffix}`;
    selectedMcpName = `selected-mcp-${suffix}`;
    extraMcpName = `extra-mcp-${suffix}`;

    selectedSkillDir = join(repoRoot, "skills", selectedSkillName);
    extraSkillDir = join(repoRoot, "skills", extraSkillName);
    selectedMcpPath = join(repoRoot, "mcps", `${selectedMcpName}.json`);
    extraMcpPath = join(repoRoot, "mcps", `${extraMcpName}.json`);

    mkdirSync(selectedSkillDir, { recursive: true });
    mkdirSync(extraSkillDir, { recursive: true });

    writeFileSync(
      join(selectedSkillDir, "SKILL.md"),
      `---\nname: ${selectedSkillName}\n---\n# ${selectedSkillName}\n`,
    );
    writeFileSync(
      join(extraSkillDir, "SKILL.md"),
      `---\nname: ${extraSkillName}\n---\n# ${extraSkillName}\n`,
    );

    writeFileSync(
      selectedMcpPath,
      JSON.stringify(
        {
          description: "selected",
          config: { command: "npx", args: ["-y", "@test/selected"] },
        },
        null,
        2,
      ) + "\n",
    );
    writeFileSync(
      extraMcpPath,
      JSON.stringify(
        {
          description: "extra",
          config: { command: "npx", args: ["-y", "@test/extra"] },
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(join(homeDir, ".ai-kit"), { recursive: true });
    writeFileSync(
      join(homeDir, ".ai-kit", "state.json"),
      JSON.stringify(
        {
          installations: [
            {
              target: "codex",
              global: false,
              path: projectDir,
              skills: [selectedSkillName],
              mcps: [selectedMcpName],
              installedAt: "2026-01-01T00:00:00Z",
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(selectedSkillDir, { recursive: true, force: true });
    rmSync(extraSkillDir, { recursive: true, force: true });
    rmSync(selectedMcpPath, { force: true });
    rmSync(extraMcpPath, { force: true });
  });

  test("replays only the tracked skill and MCP selections", () => {
    const script = `
      import { sync } from ${JSON.stringify(syncUrl)};
      sync();
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(
      existsSync(join(projectDir, ".agents", "skills", selectedSkillName, "SKILL.md")),
    ).toBe(true);
    expect(
      existsSync(join(projectDir, ".agents", "skills", extraSkillName, "SKILL.md")),
    ).toBe(false);

    const toml = readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain(`[mcp_servers.${selectedMcpName}]`);
    expect(toml).not.toContain(`[mcp_servers.${extraMcpName}]`);
  });
});
