import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detach } from "./update";

describe("detach", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-detach-"));
    skillsDir = join(tmpDir, "skills");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSkill(name: string, opts?: { withSource?: boolean }) {
    const dir = join(skillsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nSkill content`);
    if (opts?.withSource) {
      writeFileSync(join(dir, "source.json"), JSON.stringify({ from: "org/repo", skill: name, fetchedAt: "2026-01-01" }));
    }
  }

  test("deletes source.json from skill directory", () => {
    createSkill("my-skill", { withSource: true });

    detach("my-skill", skillsDir);

    expect(existsSync(join(skillsDir, "my-skill", "source.json"))).toBe(false);
  });

  test("keeps SKILL.md intact after detach", () => {
    createSkill("my-skill", { withSource: true });
    const skillPath = join(skillsDir, "my-skill", "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    detach("my-skill", skillsDir);

    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf-8")).toBe(content);
  });

  test("errors when skill not found", () => {
    mkdirSync(skillsDir, { recursive: true });

    const mockExit = mock(() => { throw new Error("process.exit"); });
    const origExit = process.exit;
    process.exit = mockExit as any;

    try {
      expect(() => detach("nonexistent", skillsDir)).toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = origExit;
    }
  });

  test("errors when skill is already local", () => {
    createSkill("my-skill");

    const mockExit = mock(() => { throw new Error("process.exit"); });
    const origExit = process.exit;
    process.exit = mockExit as any;

    try {
      expect(() => detach("my-skill", skillsDir)).toThrow("process.exit");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      process.exit = origExit;
    }
  });
});
