import { describe, test, expect } from "bun:test";

import { add } from "./add";

describe("addSkill", () => {
  // No file is written on this path: addSkill throws before scaffolding or fetching,
  // so it needs no temp-dir isolation of SKILLS_DIR.
  test("--skill without --from throws", () => {
    expect(() => add("skill", "some-nonexistent-skill", { skill: "upstream" })).toThrow("--skill requires --from");
  });
});
