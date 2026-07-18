#!/usr/bin/env bun

import { add } from "./add";
import { configInstall } from "./config-install";
import { install } from "./install";
import { list } from "./list";
import { log } from "./log";
import { installService, statusService, uninstallService } from "./service";
import { sync } from "./sync";
import { update, detach } from "./update";
import { watch } from "./watch";

const args = process.argv.slice(2);
const command = args[0];
const VALUE_FLAGS = new Set(["skills", "mcps", "from", "interval"]);

export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(key) && next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function showHelp(): void {
  console.log(`
  AI Kit — Centralized AI Skills & MCP Manager

  Usage:
    ai-kit install <target>                   Install skills and MCPs to a target
    ai-kit config install [target] [--force]  Install harness config to a target (global; default all)
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

  Examples:
    ai-kit install claude
    ai-kit install claude --global
    ai-kit install all --global
    ai-kit install codex --skills review,humanizer --mcps playwright
    ai-kit install pi
    ai-kit skill add frontend-design --from anthropics/skills
    ai-kit skill update
    ai-kit sync
`);
}

if (import.meta.main) {
  if (!command || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case "install": {
        const target = args[1];
        if (!target) {
          log.error("Missing target. Usage: ai-kit install <target>");
          process.exit(1);
        }
        const flags = parseFlags(args.slice(2));
        install(target, {
          global: flags.global === true,
          skills: typeof flags.skills === "string" ? flags.skills.split(",") : undefined,
          mcps: typeof flags.mcps === "string" ? flags.mcps.split(",") : undefined,
        });
        break;
      }

      case "config": {
        const verb = args[1];
        if (verb === "install") {
          const target = args[2] && !args[2].startsWith("--") ? args[2] : undefined;
          const flags = parseFlags(args.slice(2));
          configInstall(target, { force: flags.force === true });
        } else {
          log.error(`Unknown command: ai-kit config ${verb ?? ""}`.trim() + ". Available: install");
          showHelp();
          process.exit(1);
        }
        break;
      }

      case "list": {
        list();
        break;
      }

      case "sync": {
        sync();
        break;
      }

      case "watch": {
        const verb = args[1];
        const flags = parseFlags(args.slice(verb && !verb.startsWith("--") ? 2 : 1));
        const interval = typeof flags.interval === "string" ? Number(flags.interval) : NaN;
        if (typeof flags.interval === "string" && (!Number.isFinite(interval) || interval <= 0)) {
          log.error("--interval must be a positive number of seconds");
          process.exit(1);
        }
        const intervalSeconds = Number.isFinite(interval) ? interval : undefined;

        if (verb === "install") {
          installService({ intervalSeconds });
        } else if (verb === "uninstall") {
          uninstallService();
        } else if (verb === "status") {
          statusService();
        } else if (!verb || verb.startsWith("--")) {
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
        const verb = args[1];
        if (verb === "add") {
          const name = args[2];
          if (!name) {
            log.error(`Usage: ai-kit ${resource} add <name>`);
            process.exit(1);
          }
          const addFlags = parseFlags(args.slice(3));
          add(resource, name, {
            from: typeof addFlags.from === "string" ? addFlags.from : undefined,
          });
        } else if (resource === "skill" && verb === "update") {
          update(args[2]);
        } else if (resource === "skill" && verb === "detach") {
          const name = args[2];
          if (!name) {
            log.error("Usage: ai-kit skill detach <name>");
            process.exit(1);
          }
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
