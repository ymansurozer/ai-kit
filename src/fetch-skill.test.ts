import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { replaceSkillDir, resolveFetchNames, rewriteFrontmatterName } from "./fetch-skill";

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

describe("rewriteFrontmatterName", () => {
  test("replaces an existing name line with the local name", () => {
    const content = "---\nname: upstream-name\ndescription: does a thing\n---\n\n# Body\n";
    expect(rewriteFrontmatterName(content, "local-name")).toBe(
      "---\nname: local-name\ndescription: does a thing\n---\n\n# Body\n",
    );
  });

  test("inserts a name line first when the block has none", () => {
    const content = "---\ndescription: does a thing\n---\n\n# Body\n";
    expect(rewriteFrontmatterName(content, "local-name")).toBe(
      "---\nname: local-name\ndescription: does a thing\n---\n\n# Body\n",
    );
  });

  test("returns content unchanged when there is no frontmatter block", () => {
    const content = "# Body\n\nname: not-frontmatter\n";
    expect(rewriteFrontmatterName(content, "local-name")).toBe(content);
  });

  test("never touches a name occurrence in the body", () => {
    const content = "---\nname: upstream-name\n---\n\nSome text mentioning name: keep-me here.\n";
    expect(rewriteFrontmatterName(content, "local-name")).toBe(
      "---\nname: local-name\n---\n\nSome text mentioning name: keep-me here.\n",
    );
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
