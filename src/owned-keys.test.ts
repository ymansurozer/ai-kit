import { describe, test, expect } from "bun:test";

import { spliceOwnedKeys, stripOwnedKeys } from "./owned-keys";
import { parseStructured, type StructuredKind } from "./structured";

const KINDS: StructuredKind[] = ["json", "toml"];

/** Render a value in `kind` so the same fixture can drive both formats. */
function render(kind: StructuredKind, value: Record<string, unknown>): string {
  return kind === "json"
    ? JSON.stringify(value, null, 2) + "\n"
    : Object.entries(value)
        .map(([key, val]) => `${key} = ${JSON.stringify(val)}\n`)
        .join("");
}

describe("stripOwnedKeys", () => {
  for (const kind of KINDS) {
    test(`removes the declared keys (${kind})`, () => {
      const content = render(kind, { model: "opus", theme: "dark", editor: "vim" });
      const stripped = stripOwnedKeys(content, ["model"], kind, `x.${kind}`);
      expect(JSON.parse(stripped)).toEqual({ theme: "dark", editor: "vim" });
    });

    test(`an empty key list keeps everything (${kind})`, () => {
      const content = render(kind, { model: "opus", theme: "dark" });
      expect(JSON.parse(stripOwnedKeys(content, [], kind, `x.${kind}`))).toEqual({ model: "opus", theme: "dark" });
    });

    test(`a declared key the file lacks is a no-op (${kind})`, () => {
      const content = render(kind, { theme: "dark" });
      expect(JSON.parse(stripOwnedKeys(content, ["model", "projects"], kind, `x.${kind}`))).toEqual({ theme: "dark" });
    });

    test(`corrupt content throws naming the source (${kind})`, () => {
      const corrupt = kind === "json" ? "{oops" : "= nope";
      expect(() => stripOwnedKeys(corrupt, ["model"], kind, `config/claude/broken.${kind}`)).toThrow(
        new RegExp(`config/claude/broken\\.${kind}`),
      );
    });
  }

  test("key order does not change the output", () => {
    const a = stripOwnedKeys('{"model":"opus","theme":"dark","editor":"vim"}', ["model"], "json", "a.json");
    const b = stripOwnedKeys('{"editor":"vim","theme":"dark","model":"sonnet"}', ["model"], "json", "b.json");
    expect(a).toBe(b);
  });

  test("nested key order does not change the output either", () => {
    const a = stripOwnedKeys('{"ui":{"theme":"dark","font":"mono"}}', [], "json", "a.json");
    const b = stripOwnedKeys('{"ui":{"font":"mono","theme":"dark"}}', [], "json", "b.json");
    expect(a).toBe(b);
  });

  test("array order is content, not formatting", () => {
    const a = stripOwnedKeys('{"allow":["a","b"]}', [], "json", "a.json");
    const b = stripOwnedKeys('{"allow":["b","a"]}', [], "json", "b.json");
    expect(a).not.toBe(b);
  });

  test("formatting-only differences hash the same", () => {
    const a = stripOwnedKeys('{"a":1,"b":{"c":2}}', [], "json", "a.json");
    const b = stripOwnedKeys('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n', [], "json", "b.json");
    expect(a).toBe(b);
  });

  test("equal content in either format strips to the same canonical string", () => {
    const json = stripOwnedKeys('{"model":"opus","theme":"dark"}', ["model"], "json", "a.json");
    const toml = stripOwnedKeys('theme = "dark"\nmodel = "sonnet"\n', ["model"], "toml", "a.toml");
    expect(json).toBe(toml);
  });

  test("TOML tables and dates canonicalize deterministically", () => {
    const a = stripOwnedKeys("[b]\nz = 1\na = 1979-05-27T07:32:00Z\n", [], "toml", "a.toml");
    const b = stripOwnedKeys("[b]\na = 1979-05-27T07:32:00Z\nz = 1\n", [], "toml", "b.toml");
    expect(a).toBe(b);
    expect(a).toContain("1979-05-27");
  });
});

describe("spliceOwnedKeys", () => {
  const labels = { repo: "config/claude/settings.json", dest: "/home/u/.claude/settings.json" };

  for (const kind of KINDS) {
    const parse = (content: string) => parseStructured(kind, content, `x.${kind}`);
    const sourceLabels = { repo: `config/t/x.${kind}`, dest: `/home/u/x.${kind}` };

    test(`the destination's value for an owned key wins (${kind})`, () => {
      const repo = render(kind, { model: "opus", theme: "dark" });
      const dest = render(kind, { model: "sonnet", theme: "light" });
      const out = spliceOwnedKeys(repo, dest, ["model"], kind, sourceLabels);
      expect(parse(out)).toEqual({ model: "sonnet", theme: "dark" });
    });

    test(`a key the destination lacks is dropped from the result (${kind})`, () => {
      const repo = render(kind, { model: "opus", theme: "dark" });
      const dest = render(kind, { theme: "light" });
      expect(parse(spliceOwnedKeys(repo, dest, ["model"], kind, sourceLabels))).toEqual({ theme: "dark" });
    });

    test(`an owned key only the destination has is carried over (${kind})`, () => {
      const repo = render(kind, { theme: "dark" });
      const dest = render(kind, { theme: "light", model: "sonnet" });
      expect(parse(spliceOwnedKeys(repo, dest, ["model"], kind, sourceLabels))).toEqual({
        theme: "dark",
        model: "sonnet",
      });
    });

    test(`an empty key list is the identity in parsed terms (${kind})`, () => {
      const repo = render(kind, { model: "opus", theme: "dark" });
      const dest = render(kind, { model: "sonnet", theme: "light", extra: "no" });
      expect(parse(spliceOwnedKeys(repo, dest, [], kind, sourceLabels))).toEqual(parse(repo));
    });

    test(`corrupt repo content throws naming the repo source (${kind})`, () => {
      const corrupt = kind === "json" ? "{oops" : "= nope";
      expect(() => spliceOwnedKeys(corrupt, render(kind, {}), ["model"], kind, sourceLabels)).toThrow(
        new RegExp(`config/t/x\\.${kind}`),
      );
    });

    test(`corrupt destination content throws naming the destination (${kind})`, () => {
      const corrupt = kind === "json" ? "{oops" : "= nope";
      expect(() => spliceOwnedKeys(render(kind, { a: 1 }), corrupt, ["model"], kind, sourceLabels)).toThrow(
        new RegExp(`/home/u/x\\.${kind}`),
      );
    });
  }

  test("non-owned keys keep the repo's values and order", () => {
    const repo = '{\n  "a": 1,\n  "model": "opus",\n  "b": 2\n}\n';
    const dest = '{\n  "b": 99,\n  "model": "sonnet",\n  "a": 98\n}\n';
    const out = spliceOwnedKeys(repo, dest, ["model"], "json", labels);
    expect(out).toBe('{\n  "a": 1,\n  "model": "sonnet",\n  "b": 2\n}\n');
  });

  test("an owned key the repo lacks is appended after the repo's own keys", () => {
    const out = spliceOwnedKeys('{"a":1,"b":2}', '{"model":"sonnet"}', ["model"], "json", labels);
    expect(Object.keys(JSON.parse(out))).toEqual(["a", "b", "model"]);
  });

  test("owned nested values are taken wholesale from the destination", () => {
    const repo = '{"permissions":{"allow":["repo"]},"theme":"dark"}';
    const dest = '{"permissions":{"deny":["dest"]}}';
    expect(JSON.parse(spliceOwnedKeys(repo, dest, ["permissions"], "json", labels))).toEqual({
      permissions: { deny: ["dest"] },
      theme: "dark",
    });
  });

  test("TOML output is written as TOML, not JSON", () => {
    const out = spliceOwnedKeys('theme = "dark"\n', "projects = { a = 1 }\n", ["projects"], "toml", labels);
    expect(out).toContain('theme = "dark"');
    expect(parseStructured("toml", out, "x.toml")).toEqual({ theme: "dark", projects: { a: 1 } });
  });
});
