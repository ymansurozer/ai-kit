import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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

    writeFileSync(join(selectedSkillDir, "SKILL.md"), `---\nname: ${selectedSkillName}\n---\n# ${selectedSkillName}\n`);
    writeFileSync(join(extraSkillDir, "SKILL.md"), `---\nname: ${extraSkillName}\n---\n# ${extraSkillName}\n`);

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
    expect(existsSync(join(projectDir, ".agents", "skills", selectedSkillName, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".agents", "skills", extraSkillName, "SKILL.md"))).toBe(false);

    const toml = readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain(`[mcp_servers.${selectedMcpName}]`);
    expect(toml).not.toContain(`[mcp_servers.${extraMcpName}]`);
  });

  test("an 'all' selection (undefined) re-scans and installs a skill/MCP added after install", () => {
    // Record the install as "all" (no skills/mcps keys), the shape a full install
    // now writes. The extra skill/MCP were created after — they must still land.
    writeFileSync(
      join(homeDir, ".ai-kit", "state.json"),
      JSON.stringify(
        {
          installations: [{ target: "codex", global: false, path: projectDir, installedAt: "2026-01-01T00:00:00Z" }],
        },
        null,
        2,
      ) + "\n",
    );

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
    expect(existsSync(join(projectDir, ".agents", "skills", selectedSkillName, "SKILL.md"))).toBe(true);
    expect(existsSync(join(projectDir, ".agents", "skills", extraSkillName, "SKILL.md"))).toBe(true);

    const toml = readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain(`[mcp_servers.${selectedMcpName}]`);
    expect(toml).toContain(`[mcp_servers.${extraMcpName}]`);
  });

  test("end-to-end: sync removes a skill and MCP deleted from the repo; a hand-placed skill dir survives", () => {
    const installUrl = pathToFileURL(join(repoRoot, "src", "install.ts")).href;

    // A full per-repo install records a snapshot of everything in the repo now.
    const installScript = `
      import { install } from ${JSON.stringify(installUrl)};
      install("codex", { global: false, cwd: ${JSON.stringify(projectDir)} });
    `;
    let result = spawnSync(process.execPath, ["-e", installScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    const skillsRoot = join(projectDir, ".agents", "skills");
    expect(existsSync(join(skillsRoot, selectedSkillName, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsRoot, extraSkillName, "SKILL.md"))).toBe(true);

    // A skill dir ai-kit never installed — the ownership contract must spare it.
    mkdirSync(join(skillsRoot, "hand-skill"), { recursive: true });
    writeFileSync(join(skillsRoot, "hand-skill", "SKILL.md"), "hand\n");

    // Delete one skill + one MCP from the repo, then sync.
    rmSync(extraSkillDir, { recursive: true, force: true });
    rmSync(extraMcpPath, { force: true });

    const syncScript = `
      import { sync } from ${JSON.stringify(syncUrl)};
      sync();
    `;
    result = spawnSync(process.execPath, ["-e", syncScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);

    expect(existsSync(join(skillsRoot, selectedSkillName, "SKILL.md"))).toBe(true);
    expect(existsSync(join(skillsRoot, extraSkillName))).toBe(false);
    expect(existsSync(join(skillsRoot, "hand-skill", "SKILL.md"))).toBe(true);

    const toml = readFileSync(join(projectDir, ".codex", "config.toml"), "utf-8");
    expect(toml).toContain(`[mcp_servers.${selectedMcpName}]`);
    expect(toml).not.toContain(`[mcp_servers.${extraMcpName}]`);
  });
});
