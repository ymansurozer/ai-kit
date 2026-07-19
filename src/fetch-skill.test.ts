import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { replaceSkillDir, resolveFetchNames } from "./fetch-skill";

describe("resolveFetchNames", () => {
  test("defaults upstreamSkill to localName when not given", () => {
    expect(resolveFetchNames("my-skill")).toEqual({ localName: "my-skill", upstreamSkill: "my-skill" });
  });

  test("keeps an explicit upstreamSkill unchanged alongside localName", () => {
    expect(resolveFetchNames("my-skill", "upstream-skill")).toEqual({
      localName: "my-skill",
      upstreamSkill: "upstream-skill",
    });
  });
});

describe("replaceSkillDir", () => {
  let tmpDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-fetch-skill-"));
    srcDir = join(tmpDir, "src");
    destDir = join(tmpDir, "dest");
    mkdirSync(srcDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("copies fresh content into a destination that doesn't exist yet", () => {
    writeFileSync(join(srcDir, "SKILL.md"), "fresh content");

    replaceSkillDir(srcDir, destDir);

    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toBe("fresh content");
  });

  test("drops files the upstream fetch no longer has (renamed/deleted files don't linger)", () => {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "SKILL.md"), "old content");
    writeFileSync(join(destDir, "removed.md"), "stale — upstream deleted this");
    writeFileSync(join(srcDir, "SKILL.md"), "new content");

    replaceSkillDir(srcDir, destDir);

    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toBe("new content");
    expect(existsSync(join(destDir, "removed.md"))).toBe(false);
  });

  test("clears an existing source.json too — the caller rewrites it right after", () => {
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "source.json"), JSON.stringify({ fetchedAt: "old" }));
    writeFileSync(join(srcDir, "SKILL.md"), "new content");

    replaceSkillDir(srcDir, destDir);

    expect(existsSync(join(destDir, "source.json"))).toBe(false);
    expect(readFileSync(join(destDir, "SKILL.md"), "utf-8")).toBe("new content");
  });
});
