import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { Skill, McpConfig } from "../config";
import { installPi } from "./pi";

describe("installPi", () => {
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

  test("copies per-repo skills to .agents/skills/", () => {
    installPi([makeSkill("review")], [], false, tmpDir);

    const dest = join(tmpDir, ".agents", "skills", "review", "SKILL.md");
    expect(readFileSync(dest, "utf-8")).toContain("# review");
  });

  test("skips MCPs", () => {
    installPi([], [makeMcp("playwright")], false, tmpDir);

    expect(() => readFileSync(join(tmpDir, ".mcp.json"), "utf-8")).toThrow();
  });
});
