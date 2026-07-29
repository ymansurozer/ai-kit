import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { log } from "./log";
import { readState } from "./state";

export const SYSTEMD_UNIT_NAME = "ai-kit-watch.service";
export const LAUNCHD_LABEL = "com.ai-kit.watch";

/** Everything the generated unit/plist needs, resolved to absolute values at install time. */
export interface ServiceConfig {
  /** Absolute path to the bun binary. */
  bunPath: string;
  /** Absolute path to the ai-kit CLI entry (src/cli.ts). */
  cliPath: string;
  /** The checkout to watch, baked in as the working directory. */
  cwd: string;
  /** Poll interval in seconds; omitted to use watch's default. */
  intervalSeconds?: number;
  /** PATH the service runs with, so it can find bun and git. */
  pathEnv: string;
  /** Log file for launchd (systemd uses journald). */
  logPath?: string;
}

/** The command a service runs: `<bun> <cli> watch [--interval N]`. */
export function serviceExecArgs(cfg: ServiceConfig): string[] {
  const args = [cfg.bunPath, cfg.cliPath, "watch"];
  if (cfg.intervalSeconds !== undefined) {
    args.push("--interval", String(cfg.intervalSeconds));
  }
  return args;
}

/** Pure: render a systemd user unit for the watcher. */
export function renderSystemdUnit(cfg: ServiceConfig): string {
  const execStart = serviceExecArgs(cfg).join(" ");
  return `[Unit]
Description=AI Kit watch — auto-sync skills and MCPs
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${cfg.cwd}
ExecStart=${execStart}
# always, not on-failure: earlyoom kills by SIGTERM, which systemd counts as a
# clean exit — on-failure would leave the watcher dead until someone noticed.
Restart=always
RestartSec=10
# Keep the watcher off OOM killers' preferred-victim lists (earlyoom badness-boosts
# anything named "bun"); the watcher itself is a few MB and never the real hog.
OOMScoreAdjust=-500
Environment=PATH=${cfg.pathEnv}

[Install]
WantedBy=default.target
`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Pure: render a launchd agent plist for the watcher. */
export function renderLaunchdPlist(cfg: ServiceConfig): string {
  const programArgs = serviceExecArgs(cfg)
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  const logPath = cfg.logPath ?? join(homedir(), "Library", "Logs", "ai-kit-watch.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(cfg.cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(cfg.pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

/**
 * Pure: build a PATH for the service that includes the directories holding bun and
 * git, followed by the usual locations, de-duplicated and order-preserving.
 */
export function computePathEnv(bunPath: string, gitPath: string | null): string {
  const dirs = [dirname(bunPath)];
  if (gitPath) {
    dirs.push(dirname(gitPath));
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  return [...new Set(dirs)].join(":");
}

// --- Impure wrappers (path resolution, file writes, daemon control) ---

const systemdUnitPath = () => join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
const launchdPlistPath = () => join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const launchdLogPath = () => join(homedir(), "Library", "Logs", "ai-kit-watch.log");
const journalctlCmd = `journalctl --user -u ${SYSTEMD_UNIT_NAME} -f`;
const tailCmd = () => `tail -f ${launchdLogPath()}`;

function which(cmd: string): string | null {
  return typeof Bun !== "undefined" ? Bun.which(cmd) : null;
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function resolveConfig(intervalSeconds: number | undefined, cwd: string): ServiceConfig {
  return {
    bunPath: process.execPath,
    cliPath: fileURLToPath(new URL("./cli.ts", import.meta.url)),
    cwd,
    intervalSeconds,
    pathEnv: computePathEnv(process.execPath, which("git")),
    logPath: launchdLogPath(),
  };
}

/** Warn (never fail) if the checkout to watch doesn't look like an AI Kit repo. */
function warnIfSuspiciousCwd(cwd: string): void {
  if (!existsSync(join(cwd, ".git"))) {
    log.warn(`${cwd} is not a git repository — the watcher has nothing to pull. Install from your AI Kit checkout.`);
  }
  if (!existsSync(join(cwd, "skills"))) {
    log.warn(`${cwd} has no skills/ directory — is this your AI Kit checkout?`);
  }
}

export interface ServiceOptions {
  intervalSeconds?: number;
  cwd?: string;
}

export function installService(options: ServiceOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  warnIfSuspiciousCwd(cwd);
  const cfg = resolveConfig(options.intervalSeconds, cwd);

  if (process.platform === "linux") {
    installSystemd(cfg);
  } else if (process.platform === "darwin") {
    installLaunchd(cfg);
  } else {
    throw new Error(`Unsupported platform for watch service: ${process.platform}`);
  }
}

function installSystemd(cfg: ServiceConfig): void {
  const unitPath = systemdUnitPath();
  mkdirSync(dirname(unitPath), { recursive: true });
  writeFileSync(unitPath, renderSystemdUnit(cfg));
  log.heading("Installing AI Kit watch (systemd user service)");

  run("systemctl", ["--user", "daemon-reload"]);
  const enabled = run("systemctl", ["--user", "enable", "--now", SYSTEMD_UNIT_NAME]);
  if (!enabled.ok) {
    throw new Error(`systemctl enable failed: ${enabled.stderr.trim()}`);
  }

  // Lingering keeps the user service running after logout and across reboots.
  const linger = run("loginctl", ["enable-linger", process.env.USER ?? ""]);
  if (!linger.ok) {
    log.warn(`Could not enable lingering automatically — run this once so the service survives reboots:`);
    log.dim(`  sudo loginctl enable-linger ${process.env.USER ?? "$USER"}`);
  }

  log.success(`Watching ${cfg.cwd}`);
  log.info(`Status: ai-kit watch status   Logs: ${journalctlCmd}`);
}

function installLaunchd(cfg: ServiceConfig): void {
  const plistPath = launchdPlistPath();
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(dirname(launchdLogPath()), { recursive: true });
  writeFileSync(plistPath, renderLaunchdPlist(cfg));
  log.heading("Installing AI Kit watch (launchd agent)");

  const domain = `gui/${process.getuid?.() ?? ""}`;
  // Replace any prior instance, then load and force a start.
  run("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`]);
  const loaded = run("launchctl", ["bootstrap", domain, plistPath]);
  if (!loaded.ok) {
    throw new Error(`launchctl bootstrap failed: ${loaded.stderr.trim()}`);
  }
  run("launchctl", ["kickstart", "-k", `${domain}/${LAUNCHD_LABEL}`]);

  log.success(`Watching ${cfg.cwd}`);
  log.info(`Status: ai-kit watch status   Logs: ${tailCmd()}`);
}

export function uninstallService(): void {
  if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    run("systemctl", ["--user", "disable", "--now", SYSTEMD_UNIT_NAME]);
    if (existsSync(unitPath)) {
      rmSync(unitPath);
    }
    run("systemctl", ["--user", "daemon-reload"]);
    log.success("AI Kit watch service removed");
  } else if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();
    const domain = `gui/${process.getuid?.() ?? ""}`;
    run("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`]);
    if (existsSync(plistPath)) {
      rmSync(plistPath);
    }
    log.success("AI Kit watch service removed");
  } else {
    throw new Error(`Unsupported platform for watch service: ${process.platform}`);
  }
}

function lastSync(): string {
  const state = readState();
  const times = state.installations.map((i) => i.installedAt).filter(Boolean);
  if (times.length === 0) {
    return "never (no tracked installations yet)";
  }
  return times.toSorted().at(-1)!;
}

function extract(content: string, re: RegExp): string | undefined {
  return content.match(re)?.[1];
}

export function statusService(): void {
  log.heading("AI Kit watch status");

  if (process.platform === "linux") {
    const unitPath = systemdUnitPath();
    if (!existsSync(unitPath)) {
      log.warn("Not installed — run `ai-kit watch install` from your AI Kit checkout.");
      return;
    }
    const active = run("systemctl", ["--user", "is-active", SYSTEMD_UNIT_NAME]).stdout.trim();
    const watched = extract(readFileSync(unitPath, "utf-8"), /^WorkingDirectory=(.*)$/m);
    if (active === "active") {
      log.success("Running");
    } else {
      log.warn(`Installed but not running (state: ${active || "unknown"})`);
    }
    log.info(`Watching: ${watched ?? "unknown"}`);
    log.info(`Last sync: ${lastSync()}`);
    log.info(`Logs: ${journalctlCmd}`);
  } else if (process.platform === "darwin") {
    const plistPath = launchdPlistPath();
    if (!existsSync(plistPath)) {
      log.warn("Not installed — run `ai-kit watch install` from your AI Kit checkout.");
      return;
    }
    const domain = `gui/${process.getuid?.() ?? ""}`;
    const printed = run("launchctl", ["print", `${domain}/${LAUNCHD_LABEL}`]);
    const watched = extract(readFileSync(plistPath, "utf-8"), /<key>WorkingDirectory<\/key>\s*<string>(.*?)<\/string>/);
    if (printed.ok && /state = running/.test(printed.stdout)) {
      log.success("Running");
    } else {
      log.warn("Installed but not running");
    }
    log.info(`Watching: ${watched ?? "unknown"}`);
    log.info(`Last sync: ${lastSync()}`);
    log.info(`Logs: ${tailCmd()}`);
  } else {
    throw new Error(`Unsupported platform for watch service: ${process.platform}`);
  }
}
