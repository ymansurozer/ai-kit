import { spawnSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import {
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

import type { McpConfig, McpSetup } from "./config";
import { log } from "./log";
import { clearMcpSetupFrom, readStateFrom, saveMcpSetupTo, STATE_PATH } from "./state";

export type SetupRunner = (command: string, args: string[]) => { status: number | null; error?: Error };

export interface SetupLockOptions {
  /** A lock older than this is presumed left by a crashed run and taken over. */
  staleMs: number;
  pollMs: number;
}

const spawnRunner: SetupRunner = (command, args) => spawnSync(command, args, { stdio: "inherit" });

// Longer than any setup should take (Playwright's, browser download included, is ~45 s).
const DEFAULT_LOCK: SetupLockOptions = { staleMs: 10 * 60 * 1000, pollMs: 1000 };

// Setups attempted in this process. An `install all` fan-out or a `sync` installs
// the same MCP several times in one run; a setup — even a failed one — runs at most
// once per run, and a failure retries on the next run instead.
const attemptedThisRun = new Set<string>();

// Suites that install the repo's real MCPs set this so a test never downloads
// anything: setups are neither run nor required to be ready.
const skipSetups = () => Boolean(process.env.AI_KIT_SKIP_MCP_SETUP);

/** Identifies a setup by its exact command line, so a pinned-version bump re-runs it. */
function setupHash(setup: McpSetup): string {
  return createHash("sha256")
    .update(JSON.stringify([setup.command, ...(setup.args ?? [])]))
    .digest("hex");
}

function expandHome(path: string): string {
  return path.replace(/^~(?=\/|$)/, homedir()).replace(/\$\{HOME\}|\$HOME\b/g, homedir());
}

/**
 * A setup is ready when state records its current hash AND its `creates` path (if
 * declared) exists — so a deleted install re-runs the setup instead of trusting
 * state. An MCP without a setup is always ready.
 */
export function isSetupReady(statePath: string, mcp: McpConfig): boolean {
  if (!mcp.setup) {
    return true;
  }
  return readStateFrom(statePath).mcpSetups?.[mcp.name] === setupHash(mcp.setup) && createsPresent(mcp.setup);
}

function createsPresent(setup: McpSetup): boolean {
  return setup.creates === undefined || existsSync(expandHome(setup.creates));
}

/** Why a setup run failed, or undefined when it exited 0 and left `creates` in place. */
function setupFailure(setup: McpSetup, result: ReturnType<SetupRunner>): string | undefined {
  if (result.error) {
    return result.error.message;
  }
  if (result.status !== 0) {
    return `exit ${result.status}`;
  }
  return createsPresent(setup) ? undefined : `${setup.creates} missing`;
}

/**
 * Take an exclusive lockfile for one setup, so concurrent ai-kit runs (a pre-push
 * install while the watch service syncs) never run the same setup twice at once.
 * Blocks until the lock is free or stale; returns its release function. The lock
 * holds a token unique to this acquisition, and release only removes a lock that
 * still holds it — a slow owner whose lock went stale never deletes its successor's.
 */
function acquireLock(path: string, opts: SetupLockOptions): () => void {
  mkdirSync(dirname(path), { recursive: true });
  for (;;) {
    try {
      const token = randomUUID();
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, token);
      } finally {
        closeSync(fd);
      }
      return () => {
        try {
          if (readFileSync(path, "utf-8") === token) {
            unlinkSync(path);
          }
        } catch {
          // Already gone: nothing to release.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
    }
    let ageMs: number;
    try {
      ageMs = Date.now() - statSync(path).mtimeMs;
    } catch {
      continue; // Released between our create and stat: try again.
    }
    if (ageMs > opts.staleMs) {
      // Move the stale lock aside instead of unlinking it by name: two waiters can
      // both see it stale, and the second's unlink would delete the lock the first
      // just took, letting both run the setup at once.
      const aside = `${path}.stale-${randomUUID()}`;
      try {
        renameSync(path, aside);
      } catch {
        continue; // Another waiter moved it first, or it was released.
      }
      try {
        if (Date.now() - statSync(aside).mtimeMs <= opts.staleMs) {
          // A waiter's fresh lock replaced the stale one before our rename: put it back.
          linkSync(aside, path);
        }
      } catch {
        // A third run took the free path meanwhile; its lock stands.
      }
      try {
        unlinkSync(aside);
      } catch {
        // Already gone.
      }
      continue;
    }
    Bun.sleepSync(opts.pollMs);
  }
}

/**
 * Run each MCP's one-time `setup` unless it is already ready. Success (exit 0 with
 * `creates` present) is recorded in state; failure warns and leaves the MCP
 * unrecorded so the next run retries. Returns the
 * names of setup-backed MCPs still not ready, which the caller must not publish.
 */
export function runMcpSetupsFrom(
  statePath: string,
  mcps: McpConfig[],
  run: SetupRunner = spawnRunner,
  attempted: Set<string> = attemptedThisRun,
  lock: SetupLockOptions = DEFAULT_LOCK,
): string[] {
  const unready: string[] = [];
  for (const mcp of mcps) {
    if (!mcp.setup || isSetupReady(statePath, mcp)) {
      continue;
    }
    const hash = setupHash(mcp.setup);
    const key = `${mcp.name}-${hash.slice(0, 16)}`;
    if (!attempted.has(key)) {
      attempted.add(key);
      const release = acquireLock(join(dirname(statePath), "locks", `setup-${key}.lock`), lock);
      try {
        // Another run may have finished this setup while we waited for the lock.
        if (!isSetupReady(statePath, mcp)) {
          // A repair re-earns its record: drop the old one first, so a run that
          // fails partway (after recreating `creates`) can't read as ready.
          clearMcpSetupFrom(statePath, mcp.name);
          log.info(`Setting up MCP ${mcp.name}`);
          const failure = setupFailure(mcp.setup, run(mcp.setup.command, mcp.setup.args ?? []));
          if (failure) {
            log.warn(`Setup for MCP ${mcp.name} failed (${failure})`);
          } else {
            saveMcpSetupTo(statePath, mcp.name, hash);
          }
        }
      } finally {
        release();
      }
    }
    if (!isSetupReady(statePath, mcp)) {
      unready.push(mcp.name);
    }
  }
  return unready;
}

/** Run the setups `install` needs; returns the setup-backed MCPs still not ready. */
export function runMcpSetups(mcps: McpConfig[]): string[] {
  return skipSetups() ? [] : runMcpSetupsFrom(STATE_PATH, mcps);
}

/** The setup-backed MCPs in `mcps` that aren't ready, without running anything. */
export function unreadyMcpSetupsFrom(statePath: string, mcps: McpConfig[]): string[] {
  return skipSetups() ? [] : mcps.filter((m) => !isSetupReady(statePath, m)).map((m) => m.name);
}
