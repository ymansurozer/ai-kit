#!/usr/bin/env bun

import { install } from "./install";
import { list } from "./list";
import { sync } from "./sync";
import { add } from "./add";
import { update } from "./update";
import { log } from "./log";

const args = process.argv.slice(2);
const command = args[0];

export function parseFlags(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
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
  ai-kit — Centralized AI Skills & MCP Manager

  Usage:
    ai-kit install <target>     Install skills and MCPs to a target
    ai-kit list                 List available skills and MCPs
    ai-kit sync                 Re-sync all tracked installations
    ai-kit add skill <name>     Scaffold a new skill
    ai-kit add skill <n> --from <repo>  Add skill from skills.sh / GitHub
    ai-kit add mcp <name>       Scaffold a new MCP config
    ai-kit add server <name>    Scaffold a local MCP server (FastMCP)
    ai-kit update [name]        Update sourced skills from origin

  Targets:
    claude, codex, pi

  Flags:
    --global                    Install globally instead of per-repo
    --skills <names>            Cherry-pick skills (comma-separated)
    --mcps <names>              Cherry-pick MCPs (comma-separated)
    --from <source>             Source repo for external skills (uses skills CLI)

  Examples:
    ai-kit install claude
    ai-kit install claude --global
    ai-kit install codex --skills review,humanizer --mcps playwright
    ai-kit install pi
    ai-kit add skill frontend-design --from vercel-labs/agent-skills
    ai-kit update
    ai-kit sync
`);
}

if (import.meta.main) {

if (!command || command === "--help" || command === "-h") {
  showHelp();
  process.exit(0);
}

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
      skills:
        typeof flags.skills === "string"
          ? flags.skills.split(",")
          : undefined,
      mcps:
        typeof flags.mcps === "string" ? flags.mcps.split(",") : undefined,
    });
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

  case "add": {
    const type = args[1];
    const name = args[2];
    if (!type || !name) {
      log.error("Usage: ai-kit add <skill|mcp|server> <name>");
      process.exit(1);
    }
    const addFlags = parseFlags(args.slice(3));
    add(type, name, {
      from: typeof addFlags.from === "string" ? addFlags.from : undefined,
    });
    break;
  }

  case "update": {
    update(args[1]);
    break;
  }

  default: {
    log.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }
}

} // import.meta.main
