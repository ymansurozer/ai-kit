import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { detach, update } from "./update";

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
      writeFileSync(
        join(dir, "source.json"),
        JSON.stringify({ from: "org/repo", skill: name, fetchedAt: "2026-01-01" }),
      );
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
    expect(() => detach("nonexistent", skillsDir)).toThrow("Skill not found: nonexistent");
  });

  test("errors when skill is already local", () => {
    createSkill("my-skill");
    expect(() => detach("my-skill", skillsDir)).toThrow("already local");
  });
});

describe("update", () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-update-"));
    skillsDir = join(tmpDir, "skills");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createSourcedSkill(localName: string, opts: { from: string; skill: string }) {
    const dir = join(skillsDir, localName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${localName}\n---\nSkill content`);
    writeFileSync(
      join(dir, "source.json"),
      JSON.stringify({ from: opts.from, skill: opts.skill, fetchedAt: "2026-01-01" }),
    );
  }

  test("re-fetches a renamed skill using its recorded upstream identifier", () => {
    createSourcedSkill("local-name", { from: "owner/repo", skill: "upstream-name" });

    const calls: Array<[string, string, string | undefined]> = [];
    const fakeFetcher = (localName: string, from: string, upstreamSkill?: string) => {
      calls.push([localName, from, upstreamSkill]);
      return true;
    };

    update("local-name", skillsDir, fakeFetcher);

    expect(calls).toEqual([["local-name", "owner/repo", "upstream-name"]]);
  });

  test("passes the local name through when it matches the upstream identifier", () => {
    createSourcedSkill("my-skill", { from: "owner/repo", skill: "my-skill" });

    const calls: Array<[string, string, string | undefined]> = [];
    const fakeFetcher = (localName: string, from: string, upstreamSkill?: string) => {
      calls.push([localName, from, upstreamSkill]);
      return true;
    };

    update("my-skill", skillsDir, fakeFetcher);

    expect(calls).toEqual([["my-skill", "owner/repo", "my-skill"]]);
  });
});
