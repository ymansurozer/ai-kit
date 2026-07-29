import { describe, test, expect } from "bun:test";

import {
  computePathEnv,
  LAUNCHD_LABEL,
  renderLaunchdPlist,
  renderSystemdUnit,
  serviceExecArgs,
  type ServiceConfig,
} from "./service";

function config(over: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    bunPath: "/home/dev/.bun/bin/bun",
    cliPath: "/home/dev/ai-kit/src/cli.ts",
    cwd: "/home/dev/ai-kit",
    pathEnv: "/home/dev/.bun/bin:/usr/bin:/bin",
    logPath: "/home/dev/Library/Logs/ai-kit-watch.log",
    ...over,
  };
}

describe("serviceExecArgs", () => {
  test("runs the CLI's watch command with absolute bun + cli paths", () => {
    expect(serviceExecArgs(config())).toEqual(["/home/dev/.bun/bin/bun", "/home/dev/ai-kit/src/cli.ts", "watch"]);
  });

  test("threads the interval through when set", () => {
    expect(serviceExecArgs(config({ intervalSeconds: 30 }))).toEqual([
      "/home/dev/.bun/bin/bun",
      "/home/dev/ai-kit/src/cli.ts",
      "watch",
      "--interval",
      "30",
    ]);
  });
});

describe("renderSystemdUnit", () => {
  test("bakes in the checkout, absolute ExecStart, PATH, and restart policy", () => {
    const unit = renderSystemdUnit(config({ intervalSeconds: 45 }));
    expect(unit).toContain("WorkingDirectory=/home/dev/ai-kit");
    expect(unit).toContain("ExecStart=/home/dev/.bun/bin/bun /home/dev/ai-kit/src/cli.ts watch --interval 45");
    expect(unit).toContain("Environment=PATH=/home/dev/.bun/bin:/usr/bin:/bin");
    // always, not on-failure: a SIGTERM kill (earlyoom) counts as a clean exit.
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("OOMScoreAdjust=-500");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("omits the interval flag when unset", () => {
    const unit = renderSystemdUnit(config());
    expect(unit).toContain("ExecStart=/home/dev/.bun/bin/bun /home/dev/ai-kit/src/cli.ts watch\n");
    expect(unit).not.toContain("--interval");
  });
});

describe("renderLaunchdPlist", () => {
  test("bakes in label, program arguments, working directory, PATH, and log path", () => {
    const plist = renderLaunchdPlist(config({ intervalSeconds: 60 }));
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain("<string>/home/dev/.bun/bin/bun</string>");
    expect(plist).toContain("<string>/home/dev/ai-kit/src/cli.ts</string>");
    expect(plist).toContain("<string>watch</string>");
    expect(plist).toContain("<string>--interval</string>");
    expect(plist).toContain("<string>60</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/home/dev/ai-kit</string>");
    expect(plist).toContain("<string>/home/dev/.bun/bin:/usr/bin:/bin</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
    expect(plist).toContain("<string>/home/dev/Library/Logs/ai-kit-watch.log</string>");
  });

  test("produces a valid plist header", () => {
    const plist = renderLaunchdPlist(config());
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(plist).toContain("<!DOCTYPE plist PUBLIC");
    expect(plist).not.toContain("--interval");
  });

  test("escapes XML-significant characters in paths", () => {
    const plist = renderLaunchdPlist(config({ cwd: "/home/dev/a & b" }));
    expect(plist).toContain("<string>/home/dev/a &amp; b</string>");
  });
});

describe("computePathEnv", () => {
  test("puts the bun and git directories first, then standard locations", () => {
    const path = computePathEnv("/home/dev/.bun/bin/bun", "/usr/bin/git");
    expect(path.startsWith("/home/dev/.bun/bin:/usr/bin:")).toBe(true);
    expect(path).toContain("/bin");
  });

  test("tolerates a missing git and de-duplicates directories", () => {
    const path = computePathEnv("/usr/bin/bun", null);
    const dirs = path.split(":");
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs).toContain("/usr/bin");
  });
});
