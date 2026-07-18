import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { normalizeHostname, resolveMachineFrom, configMachine } from "./machine";
import { readMachineOverrideFrom } from "./state";

describe("normalizeHostname", () => {
  test("lowercases mixed-case names", () => {
    expect(normalizeHostname("MacBook")).toBe("macbook");
  });

  test("strips a trailing .local suffix", () => {
    expect(normalizeHostname("host.local")).toBe("host");
  });

  test("lowercases and strips .local together", () => {
    expect(normalizeHostname("Yusufs-MacBook.local")).toBe("yusufs-macbook");
  });

  test("leaves a plain lowercase name unchanged", () => {
    expect(normalizeHostname("devbox")).toBe("devbox");
  });

  test("only strips a .local at the very end", () => {
    expect(normalizeHostname("a.local.b")).toBe("a.local.b");
  });
});

describe("resolveMachineFrom", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-machine-"));
    statePath = join(tmpDir, "state.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("uses the normalized hostname when no override is stored", () => {
    expect(resolveMachineFrom(statePath, "Laptop.local")).toEqual({ name: "laptop", source: "hostname" });
  });

  test("uses the stored override, ignoring the hostname", () => {
    configMachine("dev", { statePath });
    expect(resolveMachineFrom(statePath, "Laptop.local")).toEqual({ name: "dev", source: "override" });
  });
});

describe("configMachine", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ai-kit-machine-cmd-"));
    statePath = join(tmpDir, "state.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("with a name stores the override in state", () => {
    configMachine("workstation", { statePath });
    expect(readMachineOverrideFrom(statePath)).toBe("workstation");
  });

  test("with no name prints the effective name and its source", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    let output: string;
    try {
      configMachine(undefined, { statePath, host: "Box.local" });
      output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    } finally {
      spy.mockRestore();
    }
    expect(output).toContain("box");
    expect(output).toContain("hostname");
  });

  test("no-arg after an override reports the override as the source", () => {
    configMachine("dev", { statePath });
    const spy = spyOn(console, "log").mockImplementation(() => {});
    let output: string;
    try {
      configMachine(undefined, { statePath, host: "Box.local" });
      output = spy.mock.calls.map((c) => String(c[0])).join("\n");
    } finally {
      spy.mockRestore();
    }
    expect(output).toContain("dev");
    expect(output).toContain("override");
  });
});
