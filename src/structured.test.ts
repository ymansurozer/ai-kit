import { describe, test, expect } from "bun:test";

import { parseStructured, stringifyStructured, structuredKind } from "./structured";

describe("structuredKind", () => {
  test("recognizes json and toml by extension", () => {
    expect(structuredKind("settings.json")).toBe("json");
    expect(structuredKind("nested/config.toml")).toBe("toml");
  });

  test("everything else is unstructured", () => {
    expect(structuredKind("hooks/statusline.sh")).toBeNull();
    expect(structuredKind("AGENTS.md")).toBeNull();
    expect(structuredKind("jsonish")).toBeNull();
  });
});

describe("parseStructured", () => {
  test("parses both formats to plain objects", () => {
    expect(parseStructured("json", '{"a":1}', "x.json")).toEqual({ a: 1 });
    expect(parseStructured("toml", 'a = "1"\n', "x.toml")).toEqual({ a: "1" });
  });

  test("a malformed file is named in the error", () => {
    expect(() => parseStructured("json", "{oops", "config/claude/settings.json")).toThrow(
      /config\/claude\/settings\.json/,
    );
    expect(() => parseStructured("toml", "= nope", "config/codex/config.toml")).toThrow(/config\/codex\/config\.toml/);
  });

  test("a hint is appended to the error", () => {
    expect(() => parseStructured("toml", "= nope", "x.toml", "fix it by hand")).toThrow(/fix it by hand/);
  });
});

describe("stringifyStructured", () => {
  test("json is two-space indented with a trailing newline", () => {
    expect(stringifyStructured("json", { a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  test("both formats round-trip through parse", () => {
    const value = { model: "opus", nested: { list: [1, 2] } };
    for (const kind of ["json", "toml"] as const) {
      expect(parseStructured(kind, stringifyStructured(kind, value), `x.${kind}`)).toEqual(value);
    }
  });
});
