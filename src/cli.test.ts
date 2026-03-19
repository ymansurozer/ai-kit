import { describe, test, expect } from "bun:test";
import { parseFlags } from "./cli";

describe("parseFlags", () => {
  test("parses boolean flag", () => {
    expect(parseFlags(["--global"])).toEqual({ global: true });
  });

  test("parses flag with value", () => {
    expect(parseFlags(["--skills", "a,b"])).toEqual({ skills: "a,b" });
  });

  test("parses multiple flags", () => {
    expect(parseFlags(["--global", "--skills", "a,b"])).toEqual({
      global: true,
      skills: "a,b",
    });
  });

  test("flag followed by another flag is treated as boolean", () => {
    // --from --global: since --global starts with --, --from has no value
    expect(parseFlags(["--from", "--global"])).toEqual({
      from: true,
      global: true,
    });
  });

  test("returns empty object for no flags", () => {
    expect(parseFlags([])).toEqual({});
  });

  test("ignores non-flag arguments", () => {
    expect(parseFlags(["claude", "--global", "extra"])).toEqual({
      global: "extra",
    });
  });

  test("handles flag with value containing special characters", () => {
    expect(parseFlags(["--from", "org/repo"])).toEqual({ from: "org/repo" });
  });
});
