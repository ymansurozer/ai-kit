import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

const repoRoot = join(import.meta.dir, "..");
const installUrl = pathToFileURL(join(repoRoot, "src", "install.ts")).href;

describe("install", () => {
  let homeDir: string;
  let projectDir: string;
  let skillName: string;
  let mcpName: string;
  let skillDir: string;
  let mcpPath: string;

  beforeEach(() => {
    const suffix = `${process.pid}-${Date.now()}`;
    homeDir = mkdtempSync(join(tmpdir(), "ai-kit-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "ai-kit-project-"));
    skillName = `test-skill-${suffix}`;
    mcpName = `test-mcp-${suffix}`;
    skillDir = join(repoRoot, "skills", skillName);
    mcpPath = join(repoRoot, "mcps", `${mcpName}.json`);

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: test skill\n---\n# ${skillName}\n`,
    );

    writeFileSync(
      mcpPath,
      JSON.stringify(
        {
          description: "test mcp",
          config: {
            command: "npx",
            args: ["-y", "@test/playwright"],
          },
        },
        null,
        2,
      ) + "\n",
    );
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(mcpPath, { force: true });
  });

  test("does not persist MCPs for Pi installs", () => {
    const script = `
      import { install } from ${JSON.stringify(installUrl)};
      install("pi", { global: false, cwd: ${JSON.stringify(projectDir)} });
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const statePath = join(homeDir, ".ai-kit", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(state.installations).toHaveLength(1);
    expect(state.installations[0].skills).toEqual([skillName]);
    expect(state.installations[0].mcps).toEqual([]);
  });

  test("`all` fans out to every supported target", () => {
    const script = `
      import { install } from ${JSON.stringify(installUrl)};
      install("all", {
        global: true,
        cwd: ${JSON.stringify(projectDir)},
        skills: [${JSON.stringify(skillName)}],
        mcps: [${JSON.stringify(mcpName)}],
      });
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const statePath = join(homeDir, ".ai-kit", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));

    const targets = state.installations.map((i: { target: string }) => i.target);
    expect(targets.toSorted()).toEqual(["claude", "codex", "opencode", "pi"]);

    for (const inst of state.installations) {
      expect(inst.global).toBe(true);
      expect(inst.skills).toEqual([skillName]);
      if (inst.target === "pi") {
        expect(inst.mcps).toEqual([]);
      } else {
        expect(inst.mcps).toEqual([mcpName]);
      }
    }
  });

  test("does not save an empty Pi installation when only MCPs were requested", () => {
    const script = `
      import { install } from ${JSON.stringify(installUrl)};
      install("pi", {
        global: false,
        cwd: ${JSON.stringify(projectDir)},
        skills: [],
        mcps: [${JSON.stringify(mcpName)}],
      });
    `;

    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(homeDir, ".ai-kit", "state.json"))).toBe(false);
  });
});
