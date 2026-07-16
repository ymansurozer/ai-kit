import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  decide,
  initialMemo,
  realGit,
  recordInstallFailure,
  recordInstallSuccess,
  runTick,
  type Memo,
  type Observation,
} from "./watch";

function obs(partial: Partial<Observation>): Observation {
  return { fetchOk: true, clean: true, tracking: "up-to-date", ...partial };
}

describe("decide", () => {
  test("behind + clean → pull-and-install", () => {
    const d = decide(obs({ tracking: "behind" }), initialMemo(), 0);
    expect(d.action).toBe("pull-and-install");
    expect(d.report).toBeUndefined();
  });

  test("up-to-date + clean → wait with no report", () => {
    const d = decide(obs({ tracking: "up-to-date" }), initialMemo(), 0);
    expect(d.action).toBe("wait");
    expect(d.report).toBeUndefined();
  });

  test("ahead + clean → silent wait (local unpushed work is normal)", () => {
    const d = decide(obs({ tracking: "ahead" }), initialMemo(), 0);
    expect(d.action).toBe("wait");
    expect(d.report).toBeUndefined();
  });

  test("dirty → skip and report once, then stays silent while dirty", () => {
    const first = decide(obs({ clean: false, tracking: "behind" }), initialMemo(), 0);
    expect(first.action).toBe("wait");
    expect(first.report?.level).toBe("warn");
    expect(first.report?.message).toContain("dirty");

    const second = decide(obs({ clean: false, tracking: "behind" }), first.memo, 1);
    expect(second.action).toBe("wait");
    expect(second.report).toBeUndefined();
  });

  test("dirty then clean-behind resumes syncing and re-reports on next dirty", () => {
    const dirty = decide(obs({ clean: false }), initialMemo(), 0);
    expect(dirty.report).toBeDefined();

    const clean = decide(obs({ clean: true, tracking: "behind" }), dirty.memo, 1);
    expect(clean.action).toBe("pull-and-install");
    expect(clean.memo.lastReport).toBeUndefined();

    const dirtyAgain = decide(obs({ clean: false }), clean.memo, 2);
    expect(dirtyAgain.report).toBeDefined();
  });

  test("diverged → skip and report once, never auto-resolved", () => {
    const first = decide(obs({ tracking: "diverged" }), initialMemo(), 0);
    expect(first.action).toBe("wait");
    expect(first.report?.message).toContain("diverged");

    const second = decide(obs({ tracking: "diverged" }), first.memo, 1);
    expect(second.report).toBeUndefined();
  });

  test("no-upstream → skip and report once", () => {
    const first = decide(obs({ tracking: "no-upstream" }), initialMemo(), 0);
    expect(first.action).toBe("wait");
    expect(first.report?.message).toContain("upstream");

    const second = decide(obs({ tracking: "no-upstream" }), first.memo, 1);
    expect(second.report).toBeUndefined();
  });

  test("fetch failure → skip and report once, clears on recovery", () => {
    const first = decide(obs({ fetchOk: false }), initialMemo(), 0);
    expect(first.action).toBe("wait");
    expect(first.report?.level).toBe("warn");
    expect(first.report?.message).toContain("Fetch failed");

    const stillDown = decide(obs({ fetchOk: false }), first.memo, 1);
    expect(stillDown.report).toBeUndefined();

    const recovered = decide(obs({ fetchOk: true, tracking: "up-to-date" }), stillDown.memo, 2);
    expect(recovered.action).toBe("wait");
    expect(recovered.memo.lastReport).toBeUndefined();

    const downAgain = decide(obs({ fetchOk: false }), recovered.memo, 3);
    expect(downAgain.report).toBeDefined();
  });
});

describe("install failure backoff and recovery", () => {
  test("failure arms a backoff window that suppresses hot retries, then recovers", () => {
    // A pull+install was attempted and the install failed.
    const failed = recordInstallFailure(initialMemo(), 0, new Error("write denied"));
    expect(failed.report?.level).toBe("error");
    expect(failed.memo.pendingInstall).toBe(true);
    expect(failed.memo.installFailures).toBe(1);
    expect(failed.memo.backoffUntilTick).toBeGreaterThan(0);

    // Within the backoff window we wait even though a reinstall is pending.
    const duringBackoff = decide(obs({ tracking: "up-to-date" }), failed.memo, 1);
    expect(duringBackoff.action).toBe("wait");

    // After the window elapses, the pending install is retried.
    const afterBackoff = decide(obs({ tracking: "up-to-date" }), failed.memo, failed.memo.backoffUntilTick!);
    expect(afterBackoff.action).toBe("install");

    // A success clears pending/backoff so the loop returns to idle.
    const recovered = recordInstallSuccess();
    expect(recovered.pendingInstall).toBe(false);
    expect(recovered.installFailures).toBe(0);
    const idle = decide(obs({ tracking: "up-to-date" }), recovered, 99);
    expect(idle.action).toBe("wait");
  });

  test("repeated failures grow the backoff window", () => {
    const one = recordInstallFailure(initialMemo(), 0, "x").memo;
    const two = recordInstallFailure(one, 0, "x").memo;
    expect(two.backoffUntilTick!).toBeGreaterThan(one.backoffUntilTick!);
  });

  test("a new commit while pending is still gated by backoff (no hot loop on pull failure)", () => {
    const failed = recordInstallFailure(initialMemo(), 0, "boom");
    const d = decide(obs({ tracking: "behind" }), failed.memo, 1);
    expect(d.action).toBe("wait");
  });
});

describe("runTick with a fake git seam", () => {
  function fakeGit(over: Partial<Observation> & { pullThrows?: boolean }) {
    const o = obs(over);
    let pulled = false;
    return {
      seam: {
        fetch() {
          if (!o.fetchOk) {
            throw new Error("offline");
          }
        },
        isClean: () => o.clean,
        tracking: () => o.tracking,
        pullFfOnly() {
          if (over.pullThrows) {
            throw new Error("pull failed");
          }
          pulled = true;
        },
      },
      didPull: () => pulled,
    };
  }

  test("behind + clean pulls and runs the install step", () => {
    const g = fakeGit({ tracking: "behind" });
    let installs = 0;
    const memo = runTick({ git: g.seam, install: () => installs++ }, initialMemo(), 0);
    expect(g.didPull()).toBe(true);
    expect(installs).toBe(1);
    expect(memo.pendingInstall).toBe(false);
  });

  test("install failure leaves a pending retry and backoff in the memo", () => {
    const g = fakeGit({ tracking: "behind" });
    const memo = runTick(
      {
        git: g.seam,
        install: () => {
          throw new Error("no write access");
        },
      },
      initialMemo(),
      0,
    );
    expect(memo.pendingInstall).toBe(true);
    expect(memo.backoffUntilTick).toBeGreaterThan(0);
  });

  test("up-to-date does not run the install step", () => {
    const g = fakeGit({ tracking: "up-to-date" });
    let installs = 0;
    runTick({ git: g.seam, install: () => installs++ }, initialMemo(), 0);
    expect(g.didPull()).toBe(false);
    expect(installs).toBe(0);
  });
});

describe("integration: real clones", () => {
  let root: string;
  let bare: string;
  let cloneA: string;
  let cloneB: string;

  const g = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    }
    return r.stdout;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ai-kit-watch-"));
    bare = join(root, "central.git");
    cloneA = join(root, "clone-a");
    cloneB = join(root, "clone-b");

    g(root, "init", "--bare", "--initial-branch=main", bare);

    g(root, "clone", bare, cloneA);
    g(cloneA, "config", "user.email", "a@example.com");
    g(cloneA, "config", "user.name", "Clone A");
    writeFileSync(join(cloneA, "README.md"), "seed\n");
    g(cloneA, "add", ".");
    g(cloneA, "commit", "-m", "seed");
    g(cloneA, "push", "-u", "origin", "main");

    g(root, "clone", bare, cloneB);
    g(cloneB, "config", "user.email", "b@example.com");
    g(cloneB, "config", "user.name", "Clone B");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a commit pushed from clone A is picked up by a watch tick in clone B", () => {
    // Clone B starts up-to-date: one tick, no install.
    let installs = 0;
    const ctx = { git: realGit(cloneB), install: () => installs++ };
    let memo: Memo = runTick(ctx, initialMemo(), 0);
    expect(installs).toBe(0);

    // Clone A pushes a change.
    writeFileSync(join(cloneA, "skill.md"), "new skill\n");
    g(cloneA, "add", ".");
    g(cloneA, "commit", "-m", "add skill");
    g(cloneA, "push");

    // The next tick in clone B fetches, sees it is behind, fast-forwards, and installs.
    memo = runTick(ctx, memo, 1);
    expect(installs).toBe(1);
    expect(realGit(cloneB).tracking()).toBe("up-to-date");
  });

  test("a dirty tree in clone B skips the sync", () => {
    writeFileSync(join(cloneA, "skill.md"), "new skill\n");
    g(cloneA, "add", ".");
    g(cloneA, "commit", "-m", "add skill");
    g(cloneA, "push");

    // Local uncommitted change in clone B.
    writeFileSync(join(cloneB, "scratch.txt"), "wip\n");

    let installs = 0;
    const ctx = { git: realGit(cloneB), install: () => installs++ };
    runTick(ctx, initialMemo(), 0);
    expect(installs).toBe(0);
    expect(realGit(cloneB).tracking()).toBe("behind");
  });
});
