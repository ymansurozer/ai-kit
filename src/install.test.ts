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
  let extraPaths: string[];

  const uniq = () => `${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const run = (script: string) =>
    spawnSync(process.execPath, ["-e", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: homeDir },
      encoding: "utf8",
    });

  const installScript = (target: string, options: object) =>
    `import { install } from ${JSON.stringify(installUrl)}; install(${JSON.stringify(target)}, ${JSON.stringify(options)});`;

  const makeSkill = (name: string) => {
    const dir = join(repoRoot, "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: test skill\n---\n# ${name}\n`);
    extraPaths.push(dir);
    return dir;
  };

  const makeMcp = (name: string) => {
    const path = join(repoRoot, "mcps", `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify({ description: "test", config: { command: "npx", args: ["-y", `@test/${name}`] } }, null, 2) +
        "\n",
    );
    extraPaths.push(path);
    return path;
  };

  beforeEach(() => {
    extraPaths = [];
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
    for (const p of extraPaths) {
      rmSync(p, { recursive: true, force: true });
    }
  });

  test("a corrupt global claude MCP JSON fails naming the file", () => {
    const claudeJson = join(homeDir, ".claude.json");
    writeFileSync(claudeJson, "{ this is not valid json");

    const result = run(installScript("claude", { global: true, skills: [], mcps: [mcpName] }));
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(claudeJson);
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
    // Full install → skills selection is "all" (undefined); Pi never has MCPs, so
    // its mcps selection is a permanent empty list, not "all".
    expect(state.installations[0].skills).toBeUndefined();
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

  test("a full install (no cherry-pick) records an 'all' selection (undefined)", () => {
    const script = `
      import { install } from ${JSON.stringify(installUrl)};
      install("claude", { global: true, cwd: ${JSON.stringify(projectDir)} });
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
    expect(state.installations[0].skills).toBeUndefined();
    expect(state.installations[0].mcps).toBeUndefined();
  });

  test("a cherry-picked install records its explicit selection", () => {
    const script = `
      import { install } from ${JSON.stringify(installUrl)};
      install("claude", {
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
    expect(state.installations[0].skills).toEqual([skillName]);
    expect(state.installations[0].mcps).toEqual([mcpName]);
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

  test("a second global install removes a skill dropped from the repo across every target; a hand-placed dir survives", () => {
    const skillB = `dropped-skill-${uniq()}`;
    const skillBDir = makeSkill(skillB);

    expect(run(installScript("all", { global: true })).status).toBe(0);

    const skillDirs = [
      join(homeDir, ".claude", "skills"),
      join(homeDir, ".agents", "skills"),
      join(homeDir, ".config", "opencode", "skills"),
    ];
    for (const dir of skillDirs) {
      expect(existsSync(join(dir, skillName))).toBe(true);
      expect(existsSync(join(dir, skillB))).toBe(true);
    }

    // A skill dir ai-kit never installed — it must never be pruned.
    const handDir = join(homeDir, ".claude", "skills", "hand-skill");
    mkdirSync(handDir, { recursive: true });
    writeFileSync(join(handDir, "SKILL.md"), "hand\n");

    // Drop the skill from the repo, then re-install (as sync would).
    rmSync(skillBDir, { recursive: true, force: true });
    expect(run(installScript("all", { global: true })).status).toBe(0);

    for (const dir of skillDirs) {
      expect(existsSync(join(dir, skillName))).toBe(true);
      expect(existsSync(join(dir, skillB))).toBe(false);
    }
    expect(existsSync(join(handDir, "SKILL.md"))).toBe(true);
  });

  test("a second global install removes a dropped MCP from claude JSON, codex TOML, opencode JSON; hand-added and non-MCP content survive", () => {
    const mcpB = `dropped-mcp-${uniq()}`;
    const mcpBPath = makeMcp(mcpB);

    expect(run(installScript("all", { global: true })).status).toBe(0);

    const claudeJson = join(homeDir, ".claude.json");
    const codexToml = join(homeDir, ".codex", "config.toml");
    const opencodeJson = join(homeDir, ".config", "opencode", "opencode.json");

    // Hand-add an MCP server ai-kit never installed to each destination.
    const cj = JSON.parse(readFileSync(claudeJson, "utf-8"));
    (cj.mcpServers as Record<string, unknown>)["hand-mcp"] = { type: "stdio", command: "echo" };
    writeFileSync(claudeJson, JSON.stringify(cj, null, 2) + "\n");

    const oj = JSON.parse(readFileSync(opencodeJson, "utf-8"));
    (oj.mcp as Record<string, unknown>)["hand-mcp"] = { type: "local", command: ["echo"] };
    writeFileSync(opencodeJson, JSON.stringify(oj, null, 2) + "\n");

    // Codex: a hand-added MCP section plus a non-MCP section that must survive verbatim.
    const handToml = `\n[mcp_servers.hand-mcp]\ncommand = "echo"\n\n[history]\npersistence = "save-all"\n`;
    writeFileSync(codexToml, readFileSync(codexToml, "utf-8").trimEnd() + "\n" + handToml);

    // Drop the MCP from the repo, then re-install.
    rmSync(mcpBPath, { force: true });
    expect(run(installScript("all", { global: true })).status).toBe(0);

    const cj2 = JSON.parse(readFileSync(claudeJson, "utf-8"));
    expect(cj2.mcpServers[mcpName]).toBeDefined();
    expect(cj2.mcpServers[mcpB]).toBeUndefined();
    expect(cj2.mcpServers["hand-mcp"]).toBeDefined();

    const oj2 = JSON.parse(readFileSync(opencodeJson, "utf-8"));
    expect(oj2.mcp[mcpName]).toBeDefined();
    expect(oj2.mcp[mcpB]).toBeUndefined();
    expect(oj2.mcp["hand-mcp"]).toBeDefined();

    const toml = readFileSync(codexToml, "utf-8");
    expect(toml).toContain(`[mcp_servers.${mcpName}]`);
    expect(toml).not.toContain(`[mcp_servers.${mcpB}]`);
    expect(toml).toContain("[mcp_servers.hand-mcp]");
    expect(toml).toContain("[history]");
    expect(toml).toContain('persistence = "save-all"');
  });

  test("`install all` warns about a not-found skill exactly once, not once per target", () => {
    const result = run(installScript("all", { global: true, skills: ["nonexistent"], mcps: [] }));
    expect(result.status).toBe(0);

    const output = `${result.stdout}${result.stderr}`;
    const matches = output.match(/Skill not found: nonexistent/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  test("a single-target install still warns about a not-found skill once", () => {
    const result = run(installScript("claude", { global: true, skills: ["nonexistent"], mcps: [] }));
    expect(result.status).toBe(0);

    const output = `${result.stdout}${result.stderr}`;
    const matches = output.match(/Skill not found: nonexistent/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  test("a legacy state entry (no snapshot) prunes nothing on the first run, then prunes on the second", () => {
    const skillB = `legacy-skill-${uniq()}`;
    const skillBDir = makeSkill(skillB);
    const claudeSkills = join(homeDir, ".claude", "skills");

    // Pre-upgrade world: an old ai-kit installed both skills, but state has no
    // snapshot. Place both dirs on disk and write a legacy (snapshot-less) entry.
    for (const name of [skillName, skillB]) {
      mkdirSync(join(claudeSkills, name), { recursive: true });
      writeFileSync(join(claudeSkills, name, "SKILL.md"), "x\n");
    }
    mkdirSync(join(homeDir, ".ai-kit"), { recursive: true });
    writeFileSync(
      join(homeDir, ".ai-kit", "state.json"),
      JSON.stringify({ installations: [{ target: "claude", global: true, installedAt: "old" }] }, null, 2) + "\n",
    );

    // First run after upgrade: no snapshot → nothing is pruned, even though a naive
    // impl might. Both skills are still in the repo, so both stay; snapshot recorded.
    expect(run(installScript("claude", { global: true })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillB))).toBe(true);

    // Now drop the skill from the repo and re-install: the recorded snapshot lets
    // the removal propagate.
    rmSync(skillBDir, { recursive: true, force: true });
    expect(run(installScript("claude", { global: true })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillName))).toBe(true);
    expect(existsSync(join(claudeSkills, skillB))).toBe(false);
  });

  test("a cherry-picked install that stops including a name removes it", () => {
    const skillB = `narrowed-skill-${uniq()}`;
    makeSkill(skillB);
    const claudeSkills = join(homeDir, ".claude", "skills");

    expect(run(installScript("claude", { global: true, skills: [skillName, skillB], mcps: [] })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillB))).toBe(true);

    // Narrow the selection to just the first skill — the dropped one is pruned.
    expect(run(installScript("claude", { global: true, skills: [skillName], mcps: [] })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillName))).toBe(true);
    expect(existsSync(join(claudeSkills, skillB))).toBe(false);
  });

  test("pi prunes a dropped skill even when only MCPs remain in the repo (still warns)", () => {
    const piSkills = join(homeDir, ".agents", "skills");

    // Cherry-pick the test skill/MCP so the scenario doesn't depend on what else
    // the surrounding repo ships in skills/ (a fork carrying real skills would
    // otherwise install those and break the "nothing installable" premise).
    const selection = { skills: [skillName], mcps: [mcpName] };

    // First run installs the cherry-picked skill and records a snapshot for pi.
    expect(run(installScript("pi", { global: true, ...selection })).status).toBe(0);
    expect(existsSync(join(piSkills, skillName))).toBe(true);

    // Delete the skill from the repo; the MCP stays, so this run has nothing pi
    // can install and reaches the "Pi does not support MCPs" path — which must NOT
    // short-circuit the prune now that a snapshot exists.
    rmSync(skillDir, { recursive: true, force: true });
    const second = run(installScript("pi", { global: true, ...selection }));
    expect(second.status).toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain("Pi does not support MCPs");

    expect(existsSync(join(piSkills, skillName))).toBe(false);
    const state = JSON.parse(readFileSync(join(homeDir, ".ai-kit", "state.json"), "utf-8"));
    const pi = state.installations.find((i: { target: string }) => i.target === "pi");
    expect(pi.installedSkills).toEqual([]);
    expect(pi.installedMcps).toEqual([]);
  });

  test("an install with nothing to install this run still prunes leftovers from the prior snapshot", () => {
    const claudeSkills = join(homeDir, ".claude", "skills");
    const claudeJson = join(homeDir, ".claude.json");

    // Install the beforeEach skill + MCP, recording a snapshot.
    expect(run(installScript("claude", { global: true })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillName))).toBe(true);
    expect(JSON.parse(readFileSync(claudeJson, "utf-8")).mcpServers[mcpName]).toBeDefined();

    // Empty the repo, then re-install: nothing to install this run, but the snapshot
    // records the previous skill + MCP, so both are pruned.
    rmSync(skillDir, { recursive: true, force: true });
    rmSync(mcpPath, { force: true });
    expect(run(installScript("claude", { global: true })).status).toBe(0);
    expect(existsSync(join(claudeSkills, skillName))).toBe(false);
    expect(JSON.parse(readFileSync(claudeJson, "utf-8")).mcpServers[mcpName]).toBeUndefined();
  });
});
