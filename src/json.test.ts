import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { parseJsonContent, readJsonFile } from "./json";

describe("parseJsonContent", () => {
  test("valid JSON passes through", () => {
    expect(parseJsonContent('{"a":1}', "x.json")).toEqual({ a: 1 });
  });

  test("a syntax error names the source path", () => {
    expect(() => parseJsonContent("{not json", "/some/where/config.json")).toThrow(/\/some\/where\/config\.json/);
  });

  test("a syntax error preserves the original parser message", () => {
    let message = "";
    try {
      JSON.parse("{not json");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(() => parseJsonContent("{not json", "x.json")).toThrow(message);
  });

  test("a hint is appended to the syntax error", () => {
    expect(() => parseJsonContent("{bad", "state.json", "delete it and re-run")).toThrow(/delete it and re-run/);
  });
});

describe("readJsonFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-json-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads and parses valid JSON", () => {
    const path = join(tmpDir, "ok.json");
    writeFileSync(path, '{"ok":true}');
    expect(readJsonFile(path)).toEqual({ ok: true });
  });

  test("a corrupt file fails naming the path", () => {
    const path = join(tmpDir, "broken.json");
    writeFileSync(path, "{oops");
    expect(() => readJsonFile(path)).toThrow(path);
  });

  test("a non-syntax error (ENOENT) propagates unchanged", () => {
    const path = join(tmpDir, "missing.json");
    expect(() => readJsonFile(path)).toThrow(/ENOENT/);
  });
});
