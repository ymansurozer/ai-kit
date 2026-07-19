#!/usr/bin/env bun

import { add } from "./add";
import { configCapture } from "./config-capture";
import { configInstall } from "./config-install";
import { install } from "./install";
import { list } from "./list";
import { log } from "./log";
import { configMachine } from "./machine";
import { installService, statusService, uninstallService } from "./service";
import { sync } from "./sync";
import { update, detach } from "./update";
import { watch } from "./watch";

const args = process.argv.slice(2);
const command = args[0];
const VALUE_FLAGS = new Set(["skills", "mcps", "from", "interval", "file"]);

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

/**
 * Split argv into flags and positionals. Flags starting with `--` are collected
 * by name; value flags (VALUE_FLAGS) consume the next token when it isn't itself
 * a flag. Every remaining token is a positional, wherever it appears — so a flag
 * before a positional no longer hides it from the router.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

/** Warn (not error) about flags the command doesn't recognize, so typos surface. */
export function unknownFlags(flags: Record<string, string | boolean>, known: readonly string[]): string[] {
  return Object.keys(flags).filter((name) => !known.includes(name));
}

function warnUnknownFlags(flags: Record<string, string | boolean>, known: readonly string[]): void {
  for (const name of unknownFlags(flags, known)) {
    log.warn(`Unknown flag --${name} (ignored)`);
  }
}

/** Error out on positionals the command didn't consume, naming them. */
function rejectStrayPositionals(extra: string[]): void {
  if (extra.length > 0) {
    log.error(`Unexpected argument${extra.length > 1 ? "s" : ""}: ${extra.join(", ")}`);
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
  AI Kit — Centralized AI Skills & MCP Manager

  Usage:
    ai-kit install <target>                   Install skills and MCPs to a target
    ai-kit config install [target] [--force]  Install harness config to a target (global; default all)
    ai-kit config capture [target] [--file p] Copy live machine config into the repo tree for git-diff review
    ai-kit config machine [name]              Set this machine's overlay name, or print the effective name
    ai-kit list                               List available skills and MCPs
    ai-kit sync                               Re-sync all tracked installations
    ai-kit watch                              Watch the repo and auto-sync on new commits
    ai-kit watch install [--interval <s>]     Run watch as a background service (systemd/launchd)
    ai-kit watch uninstall                    Remove the background watch service
    ai-kit watch status                       Show whether the watch service is running
    ai-kit skill add <name> [--from <source>] Scaffold a new skill, or fetch one from skills.sh / GitHub
    ai-kit skill update [name]                Update third-party skills from origin
    ai-kit skill detach <name>                Detach a skill from its upstream source
    ai-kit mcp add <name>                     Scaffold a new MCP config
    ai-kit server add <name>                  Scaffold a local MCP server (FastMCP)

  Targets:
    claude, codex, pi, opencode, all

  Flags:
    --global                    Install globally instead of per-repo
    --force                     Overwrite config destinations even if they drifted since the last install
    --skills <names>            Cherry-pick skills (comma-separated)
    --mcps <names>              Cherry-pick MCPs (comma-separated)
    --from <source>             External skill source (GitHub shorthand), e.g. anthropics/skills
    --interval <seconds>        Poll interval for watch, in seconds (default 45)
    --file <relative-path>      Capture one path relative to the config root (config capture; requires a target)

  Examples:
    ai-kit install claude
    ai-kit install claude --global
    ai-kit install all --global
    ai-kit install all --global --force
    ai-kit install codex --skills review,humanizer --mcps playwright
    ai-kit install pi
    ai-kit skill add frontend-design --from anthropics/skills
    ai-kit skill update
    ai-kit config capture
    ai-kit config install --force
    ai-kit config machine
    ai-kit sync
`);
}

if (import.meta.main) {
  // `--help`/`-h` anywhere shows top-level help rather than warning as an unknown flag.
  if (!command || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case "install": {
        const { flags, positionals } = parseArgs(args.slice(1));
        const [target, ...rest] = positionals;
        if (!target) {
          log.error("Missing target. Usage: ai-kit install <target>");
          process.exit(1);
        }
        warnUnknownFlags(flags, ["global", "force", "skills", "mcps"]);
        rejectStrayPositionals(rest);
        install(target, {
          global: flags.global === true,
          force: flags.force === true,
          skills: typeof flags.skills === "string" ? flags.skills.split(",") : undefined,
          mcps: typeof flags.mcps === "string" ? flags.mcps.split(",") : undefined,
        });
        break;
      }

      case "config": {
        const { flags, positionals } = parseArgs(args.slice(1));
        const [verb, target, ...rest] = positionals;
        if (verb === "install") {
          warnUnknownFlags(flags, ["force"]);
          rejectStrayPositionals(rest);
          configInstall(target, { force: flags.force === true });
        } else if (verb === "capture") {
          warnUnknownFlags(flags, ["file"]);
          rejectStrayPositionals(rest);
          configCapture(target, { file: typeof flags.file === "string" ? flags.file : undefined });
        } else if (verb === "machine") {
          warnUnknownFlags(flags, []);
          rejectStrayPositionals(rest);
          configMachine(target);
        } else {
          log.error(`Unknown command: ai-kit config ${verb ?? ""}`.trim() + ". Available: install, capture, machine");
          showHelp();
          process.exit(1);
        }
        break;
      }

      case "list": {
        const { flags, positionals } = parseArgs(args.slice(1));
        warnUnknownFlags(flags, []);
        rejectStrayPositionals(positionals);
        list();
        break;
      }

      case "sync": {
        const { flags, positionals } = parseArgs(args.slice(1));
        warnUnknownFlags(flags, []);
        rejectStrayPositionals(positionals);
        sync();
        break;
      }

      case "watch": {
        const { flags, positionals } = parseArgs(args.slice(1));
        const [verb, ...rest] = positionals;
        const interval = typeof flags.interval === "string" ? Number(flags.interval) : NaN;
        if (typeof flags.interval === "string" && (!Number.isFinite(interval) || interval <= 0)) {
          log.error("--interval must be a positive number of seconds");
          process.exit(1);
        }
        const intervalSeconds = Number.isFinite(interval) ? interval : undefined;

        if (verb === "install") {
          warnUnknownFlags(flags, ["interval"]);
          rejectStrayPositionals(rest);
          installService({ intervalSeconds });
        } else if (verb === "uninstall") {
          warnUnknownFlags(flags, ["interval"]);
          rejectStrayPositionals(rest);
          uninstallService();
        } else if (verb === "status") {
          warnUnknownFlags(flags, ["interval"]);
          rejectStrayPositionals(rest);
          statusService();
        } else if (!verb) {
          warnUnknownFlags(flags, ["interval"]);
          watch({ intervalMs: intervalSeconds !== undefined ? intervalSeconds * 1000 : undefined });
        } else {
          log.error(`Unknown command: ai-kit watch ${verb}`);
          showHelp();
          process.exit(1);
        }
        break;
      }

      case "skill":
      case "mcp":
      case "server": {
        const resource = command;
        const { flags, positionals } = parseArgs(args.slice(1));
        const [verb, name, ...rest] = positionals;
        if (verb === "add") {
          if (!name) {
            log.error(`Usage: ai-kit ${resource} add <name>`);
            process.exit(1);
          }
          warnUnknownFlags(flags, ["from"]);
          rejectStrayPositionals(rest);
          add(resource, name, {
            from: typeof flags.from === "string" ? flags.from : undefined,
          });
        } else if (resource === "skill" && verb === "update") {
          warnUnknownFlags(flags, []);
          rejectStrayPositionals(rest);
          update(name);
        } else if (resource === "skill" && verb === "detach") {
          if (!name) {
            log.error("Usage: ai-kit skill detach <name>");
            process.exit(1);
          }
          warnUnknownFlags(flags, []);
          rejectStrayPositionals(rest);
          detach(name);
        } else {
          log.error(`Unknown command: ai-kit ${resource} ${verb ?? ""}`.trim());
          showHelp();
          process.exit(1);
        }
        break;
      }

      default: {
        log.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
      }
    }
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} // import.meta.main
