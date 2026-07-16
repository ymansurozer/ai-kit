import { spawnSync } from "child_process";

import { log } from "./log";
import { readState } from "./state";
import { sync } from "./sync";

export const DEFAULT_INTERVAL_MS = 45_000;

/** How the local branch relates to its upstream after a fetch. */
export type Tracking = "up-to-date" | "behind" | "ahead" | "diverged" | "no-upstream";

/** A single reportable problem. Used to report each state only once until it clears. */
export type Report = { level: "info" | "warn" | "error"; message: string };

/** What one tick observed about the repo. */
export interface Observation {
  /** Whether `git fetch` succeeded this tick. When false, tracking is unknown/stale. */
  fetchOk: boolean;
  /** Whether the working tree is clean (no staged, unstaged, or untracked changes). */
  clean: boolean;
  tracking: Tracking;
}

/** Carried between ticks so the loop reports each state once and backs off after failures. */
export interface Memo {
  /** The last problem reported, so we don't repeat it every tick while it persists. */
  lastReport?: "dirty" | "diverged" | "no-upstream" | "fetch-failed" | "install-failed";
  /** A prior pull succeeded but the reinstall did not; the install must be retried. */
  pendingInstall: boolean;
  /** Consecutive install failures, used to grow the backoff window. */
  installFailures: number;
  /** Tick index before which install attempts are skipped (backoff). */
  backoffUntilTick?: number;
}

export type ActionType = "pull-and-install" | "install" | "wait";

export interface Decision {
  action: ActionType;
  report?: Report;
  memo: Memo;
}

export function initialMemo(): Memo {
  return { pendingInstall: false, installFailures: 0 };
}

/** Longest a single backoff can grow to, in ticks. */
const MAX_BACKOFF_TICKS = 20;

function backoffTicks(failures: number): number {
  return Math.min(2 ** failures, MAX_BACKOFF_TICKS);
}

/**
 * Pure decision core: given what a tick observed and the memo from the previous
 * tick, choose an action and the next memo. No I/O — the loop performs the action.
 *
 * Precedence: transient/skip states (fetch failure, dirty, diverged, no-upstream)
 * are reported once and never auto-resolved; then a backoff window is honored;
 * then a pending or newly-available sync runs; otherwise we idle and clear the
 * report so the next occurrence of a problem is reported afresh.
 */
export function decide(obs: Observation, memo: Memo, tick: number): Decision {
  // A failed fetch means we can't trust the remote state. Report once, keep ticking.
  if (!obs.fetchOk) {
    return reportOnce(memo, "fetch-failed", {
      level: "warn",
      message: "Fetch failed (offline?) — will retry",
    });
  }

  // Never touch a dirty tree. Report once; resumes automatically when clean.
  if (!obs.clean) {
    return reportOnce(memo, "dirty", {
      level: "warn",
      message: "Working tree is dirty — skipping sync until it is clean",
    });
  }

  // A non-fast-forwardable divergence is never auto-resolved.
  if (obs.tracking === "diverged") {
    return reportOnce(memo, "diverged", {
      level: "warn",
      message: "Branch has diverged from upstream — resolve manually (never merged/rebased automatically)",
    });
  }

  // A checkout without a tracking branch can't be synced. Report once.
  if (obs.tracking === "no-upstream") {
    return reportOnce(memo, "no-upstream", {
      level: "warn",
      message: "No upstream tracking branch — nothing to pull from",
    });
  }

  // Back off after an install failure rather than retrying hot.
  if (memo.backoffUntilTick !== undefined && tick < memo.backoffUntilTick) {
    return { action: "wait", memo };
  }

  // A new commit landed: fast-forward and reinstall.
  if (obs.tracking === "behind") {
    return { action: "pull-and-install", memo: clearReport(memo) };
  }

  // No new commit, but a previous reinstall failed: retry it now.
  if (memo.pendingInstall) {
    return { action: "install", memo: clearReport(memo) };
  }

  // Healthy and idle (up-to-date or locally ahead). Clear any stale report.
  return { action: "wait", memo: clearReport(memo) };
}

function reportOnce(memo: Memo, reason: NonNullable<Memo["lastReport"]>, report: Report): Decision {
  if (memo.lastReport === reason) {
    return { action: "wait", memo };
  }
  return { action: "wait", report, memo: { ...memo, lastReport: reason } };
}

function clearReport(memo: Memo): Memo {
  if (memo.lastReport === undefined) {
    return memo;
  }
  return { ...memo, lastReport: undefined };
}

/** Pure: the memo after a successful sync — pending/backoff/report state all cleared. */
export function recordInstallSuccess(): Memo {
  return { pendingInstall: false, installFailures: 0 };
}

/** Pure: fold a failed sync into the memo, arming a growing backoff window. */
export function recordInstallFailure(memo: Memo, tick: number, error: unknown): Decision {
  const installFailures = memo.installFailures + 1;
  const message = error instanceof Error ? error.message : String(error);
  return {
    action: "wait",
    report: { level: "error", message: `Reinstall failed — backing off: ${message}` },
    memo: {
      pendingInstall: true,
      installFailures,
      backoffUntilTick: tick + backoffTicks(installFailures),
      lastReport: "install-failed",
    },
  };
}

/** Git operations a tick needs, behind a seam so tests can inject a fake. */
export interface Git {
  fetch(): void;
  isClean(): boolean;
  tracking(): Tracking;
  pullFfOnly(): void;
}

function git(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitOrThrow(args: string[], cwd: string): string {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

/** The real git seam operating on an on-disk repo at `cwd`. */
export function realGit(cwd: string): Git {
  return {
    fetch() {
      gitOrThrow(["fetch", "--quiet"], cwd);
    },
    isClean() {
      return gitOrThrow(["status", "--porcelain"], cwd).trim() === "";
    },
    tracking() {
      // No upstream configured for the current branch.
      if (git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd).status !== 0) {
        return "no-upstream";
      }
      // Left count = commits upstream has that we don't (behind); right = ours it lacks (ahead).
      const counts = gitOrThrow(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd).trim();
      const [behind, ahead] = counts.split(/\s+/).map((n) => parseInt(n, 10));
      if (behind > 0 && ahead > 0) {
        return "diverged";
      }
      if (behind > 0) {
        return "behind";
      }
      if (ahead > 0) {
        return "ahead";
      }
      return "up-to-date";
    },
    pullFfOnly() {
      gitOrThrow(["pull", "--ff-only"], cwd);
    },
  };
}

export interface TickContext {
  git: Git;
  /** Reinstall to every tracked target for this machine. Injected for tests. */
  install: () => void;
}

/**
 * Run one watch cycle: observe the repo, decide, act, and fold the outcome back
 * into the memo. Returns the memo for the next tick. All reporting goes through `log`.
 */
export function runTick(ctx: TickContext, memo: Memo, tick: number): Memo {
  const obs = observe(ctx.git);
  const decision = decide(obs, memo, tick);
  emit(decision.report);
  memo = decision.memo;

  if (decision.action === "wait") {
    return memo;
  }

  try {
    if (decision.action === "pull-and-install") {
      ctx.git.pullFfOnly();
      log.info("Pulled new changes — reinstalling to all tracked targets");
    } else {
      log.info("Retrying reinstall to all tracked targets");
    }
    ctx.install();
    log.success("Sync complete");
    return recordInstallSuccess();
  } catch (err) {
    const outcome = recordInstallFailure(memo, tick, err);
    emit(outcome.report);
    return outcome.memo;
  }
}

function observe(g: Git): Observation {
  try {
    g.fetch();
  } catch {
    return { fetchOk: false, clean: true, tracking: "up-to-date" };
  }
  return { fetchOk: true, clean: g.isClean(), tracking: g.tracking() };
}

function emit(report?: Report): void {
  if (!report) {
    return;
  }
  log[report.level](report.message);
}

export interface WatchOptions {
  cwd?: string;
  intervalMs?: number;
  git?: Git;
  install?: () => void;
}

/**
 * Long-running command: keep this machine's installed skills/MCPs in sync with the
 * central repo. Fetches on an interval; when the tree is clean and strictly behind,
 * fast-forwards and reinstalls to every tracked target (parity — never a subset).
 * Dirty, diverged, no-upstream, fetch failure, and install failure are skip-and-report
 * states, never auto-resolved.
 */
export function watch(options: WatchOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const ctx: TickContext = {
    git: options.git ?? realGit(cwd),
    install: options.install ?? (() => sync()),
  };

  log.heading(`Watching ${cwd} for changes (every ${Math.round(intervalMs / 1000)}s)`);

  if (readState().installations.length === 0) {
    log.warn(
      "No tracked installations yet — run `ai-kit install all --global` first, then watch will keep them in sync.",
    );
  }

  let memo = initialMemo();
  let tick = 0;

  const cycle = () => {
    memo = runTick(ctx, memo, tick);
    tick++;
  };

  cycle();
  setInterval(cycle, intervalMs);
}
