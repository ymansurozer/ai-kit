<div align="center">

# AI Kit

**Your personal AI skills and MCP servers, in one repo.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-8b5cf6.svg)](https://github.com/anthropics/agent-skills)
[![FastMCP](https://img.shields.io/badge/servers-FastMCP-ff6b6b.svg)](https://github.com/punkpeye/fastmcp)

Centralize your [Agent Skills](https://github.com/anthropics/agent-skills) and [MCP](https://modelcontextprotocol.io/) server configs in a single git repo. Install them to **Claude Code**, **Codex**, **Pi**, or **OpenCode** — per-repo or globally — with one command.

</div>

---

## Why

You use multiple AI coding tools. Each has its own config format and file locations. You've got skills scattered across repos, MCP configs copy-pasted between projects, and no single source of truth.

**AI Kit** is a personal monorepo for all of it:

```
your-ai-kit/
├── skills/
│   ├── writing-style/SKILL.md       # your skills
│   ├── frontend-design/SKILL.md     # third-party skills
│   └── ...
├── mcps/
│   ├── playwright.json              # external MCP configs
│   └── ...
├── servers/
│   └── image-gen/index.ts           # your own MCP servers
└── package.json
```

One `ai-kit install claude` and everything lands in the right place.

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                         AI Kit repo                         │
│                                                             │
│  skills/               mcps/                servers/        │
│  ├── writing-style/    ├── playwright.json  ├── image-gen/  │
│  ├── humanizer/        └── context7.json                    │
│  └── frontend-design/                                       │
└───────────────┬─────────────────────────────┬───────────────┘
                │       ai-kit install        │
         ┌──────┴──────┐               ┌──────┴──────┐
         │  per-repo   │               │   global    │
         └──────┬──────┘               └──────┬──────┘
                │                             │
       ┌────────┼────────┐        ┌──────┬────┴────┬──────┐
       ▼        ▼        ▼        ▼      ▼         ▼      ▼
    Repo A   Repo B   Repo C   Claude  Codex   OpenCode   Pi
```

Skills use the [Agent Skills](https://github.com/anthropics/agent-skills) standard — a `SKILL.md` format natively supported by Claude Code, Codex, Pi, Cursor, Gemini CLI, and [30+ other tools](https://skills.sh).

## Quick start

### 1. Fork or clone

```bash
# Fork this repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/ai-kit.git ~/ai-kit
cd ~/ai-kit
bun install && bun link
```

> Requires [Bun](https://bun.sh). Zero runtime dependencies.

### 2. Add your skills

```bash
# Create a new skill from template
ai-kit skill add writing-style

# Or grab one from the skills.sh ecosystem
ai-kit skill add frontend-design --from anthropics/skills
```

### 3. Add your MCPs

```bash
# Create a new MCP config from template
ai-kit mcp add playwright
```

Then edit `mcps/playwright.json`. Local stdio MCPs look like this:

```json
{
  "description": "Browser automation with Playwright",
  "config": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp"]
  }
}
```

Remote HTTP MCPs work too:

```json
{
  "description": "Documentation search",
  "config": {
    "url": "https://mcp.example.com/docs"
  }
}
```

Keep committed MCP configs secret-free. Use `${VAR}` placeholders for machine-local secrets and paths:

```json
{
  "description": "Analytics MCP",
  "config": {
    "url": "https://mcp.example.com/analytics",
    "headers": {
      "Authorization": "Bearer ${ANALYTICS_API_TOKEN}"
    }
  }
}
```

### 4. Write your own MCP servers

For services that don't have an MCP server, write one directly in the repo using [FastMCP](https://github.com/punkpeye/fastmcp):

```bash
ai-kit server add image-gen
```

This scaffolds `servers/image-gen/index.ts` with a FastMCP boilerplate. Add your tools:

```typescript
import { FastMCP } from "fastmcp";
import { z } from "zod";

const server = new FastMCP("image-gen");

server.addTool({
  name: "generate_image",
  description: "Generate an image from a text prompt",
  parameters: z.object({
    prompt: z.string().describe("What to generate"),
  }),
  execute: async ({ prompt }) => {
    // call your image API here
    return "image generated";
  },
});

server.start({ transportType: "stdio" });
```

When you run `ai-kit install`, local servers are installed with their absolute path resolved automatically — no extra config needed.

### 5. Install to your tools

```bash
# Install to Claude Code in the current repo
ai-kit install claude

# Install globally
ai-kit install claude --global

# Install to Codex, Pi, or OpenCode
ai-kit install codex
ai-kit install pi
ai-kit install opencode

# Install to every supported harness at once
ai-kit install all --global

# Cherry-pick what you need
ai-kit install claude --skills writing-style,humanizer --mcps playwright
```

That's it. Commit your repo, and you have a portable, versioned collection of AI skills and MCP configs.

## Secret-free MCP configs

AI Kit treats the files in `mcps/` as the canonical source of truth. Keep them portable and secret-free:

- Use exact `${VAR}` placeholders for env values, headers, and machine-local paths
- Use `Authorization: "Bearer ${VAR}"` for bearer-token HTTP auth
- Don't commit real API keys, passwords, or local credential file paths

Example stdio MCP with secret placeholders:

```json
{
  "description": "Example service",
  "config": {
    "command": "npx",
    "args": ["-y", "example-mcp-server"],
    "env": {
      "SERVICE_USERNAME": "${SERVICE_USERNAME}",
      "SERVICE_PASSWORD": "${SERVICE_PASSWORD}",
      "CREDENTIALS_FILE": "${CREDENTIALS_FILE}"
    }
  }
}
```

At install time, AI Kit renders those placeholders into each target's native config format:

- **Claude Code**: `${VAR}` is written through as-is
- **OpenCode**: `${VAR}` becomes `{env:VAR}`
- **Codex**: stdio env placeholders become `env_vars`; HTTP header placeholders become `env_http_headers`; bearer auth becomes `bearer_token_env_var`
- **Pi**: no MCP support

Only two placeholder forms are supported in committed MCP JSON:

- Exact `${VAR}`
- `Bearer ${VAR}`
- For Codex stdio `env` entries, the key must match the var name (e.g. `"FOO": "${FOO}"`, not `"FOO": "${BAR}"`). Codex forwards via `env_vars`, which only supports same-name forwarding.

Other interpolation forms like `prefix-${VAR}` or `/path/${VAR}/file.json` are intentionally not supported.

### Where to set the values

The placeholders in `mcps/*.json` are not expanded by AI Kit at install time — they're rendered into each tool's native format and resolved at MCP launch time, reading from the parent process environment.

Export the values in your shell rc so every AI tool you launch from that shell inherits them:

```bash
# ~/.zshrc (or ~/.bashrc)
export SERVICE_USERNAME="you@example.com"
export SERVICE_PASSWORD="..."
export CREDENTIALS_FILE="$HOME/.config/example-credentials.json"
```

After editing, `source ~/.zshrc` and **restart the AI tool** (Claude Code, Codex, etc.) — long-running processes won't pick up new exports. `direnv` works too if you prefer per-directory scoping.

## Where things land

Both skills and MCPs (including local servers) support two install scopes:

- **Per-repo** (default) — installed into the current project directory. Only available when working in that repo.
- **Global** (`--global`) — installed into your home directory. Available in every project.

### Per-repo (default)

| Target   | Skills                             | MCPs                 |
| -------- | ---------------------------------- | -------------------- |
| Claude   | `.agents/skills/<name>/SKILL.md`   | `.mcp.json`          |
| Codex    | `.agents/skills/<name>/SKILL.md`   | `.codex/config.toml` |
| Pi       | `.agents/skills/<name>/SKILL.md`   | —                    |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `opencode.json`      |

### Global (`--global`)

| Target   | Skills                                      | MCPs                               |
| -------- | ------------------------------------------- | ---------------------------------- |
| Claude   | `~/.claude/commands/<name>.md`              | `~/.claude.json`                   |
| Codex    | `~/.agents/skills/<name>/SKILL.md`          | `~/.codex/config.toml`             |
| Pi       | `~/.agents/skills/<name>/SKILL.md`          | —                                  |
| OpenCode | `~/.config/opencode/skills/<name>/SKILL.md` | `~/.config/opencode/opencode.json` |

You can mix both — install some skills globally and others per-repo. `ai-kit sync` re-installs to all tracked locations.

## All commands

| Command                                   | What it does                                 |
| ----------------------------------------- | -------------------------------------------- |
| `ai-kit install <target>`                 | Install skills + MCPs to a target            |
| `ai-kit install <target> --global`        | Install globally instead of per-repo         |
| `ai-kit install all`                      | Fan out to every supported target            |
| `ai-kit install <target> --skills a,b`    | Install only specific skills                 |
| `ai-kit install <target> --mcps x,y`      | Install only specific MCPs                   |
| `ai-kit list`                             | List all available skills and MCPs           |
| `ai-kit skill add <name>`                 | Scaffold a new skill                         |
| `ai-kit skill add <name> --from <source>` | Fetch a skill from the ecosystem             |
| `ai-kit skill update`                     | Re-fetch all third-party skills              |
| `ai-kit skill update <name>`              | Re-fetch a specific third-party skill        |
| `ai-kit skill detach <name>`              | Detach a skill from its upstream source      |
| `ai-kit mcp add <name>`                   | Scaffold a new MCP config                    |
| `ai-kit server add <name>`                | Scaffold a local MCP server (FastMCP)        |
| `ai-kit sync`                             | Re-install to all previously tracked targets |
| `ai-kit watch`                            | Watch the repo and auto-sync on new commits  |
| `ai-kit watch --interval <seconds>`       | Set the poll interval (default 45s)          |
| `ai-kit watch install [--interval <s>]`   | Run watch as a boot-persistent service       |
| `ai-kit watch uninstall`                  | Remove the watch service                     |
| `ai-kit watch status`                     | Show service state, checkout, and last sync  |

## Keeping machines in sync

If you work across more than one machine, `ai-kit watch` keeps them all current with your central repo automatically. Run it from your AI Kit checkout:

```bash
ai-kit watch                    # poll every 45s (default)
ai-kit watch --interval 30      # poll every 30s
```

On each tick it fetches. When the working tree is clean **and** the branch is strictly behind its upstream, it fast-forwards (`git pull --ff-only`) and then reinstalls — to **every** target this machine has already installed, never a subset. That parity rule matters: a watcher running on several machines reinstalls exactly the set each machine tracks in `~/.ai-kit/state.json`, so no target silently drifts. Run `ai-kit install all --global` once on a new machine and `watch` keeps all four in step from then on.

Some states are reported and skipped, never resolved automatically:

- **Dirty tree** — if tracked files have uncommitted changes, the sync is skipped so your work is never touched; reported once, then it resumes on its own when the tree is clean again. Untracked files (e.g. WIP skill directories you haven't committed) don't count as dirty — a fast-forward pull coexists with them fine, and a real filename collision surfaces as a pull failure that the backoff path handles.
- **Diverged branch** — if a pull wouldn't fast-forward, it stops and reports; it never merges, rebases, or stashes for you.
- **No upstream / fetch failure** — reported once and retried on later ticks (a laptop going offline won't crash or spam the loop).
- **Install failure** — reported, then backed off rather than retried hot; the next successful sync clears the state.

### Run it as a background service

Because it runs indefinitely, `watch` is best managed as a service that starts on boot. From your AI Kit checkout:

```bash
ai-kit watch install            # register + start the service for this checkout
ai-kit watch install --interval 30
ai-kit watch status             # is it running? which checkout? last sync? where are the logs?
ai-kit watch uninstall
```

`install` bakes the current directory in as the checkout to watch (using absolute paths to `bun` and the CLI, so it doesn't depend on your `PATH`), then registers a service for your OS:

- **Linux** — a systemd **user** unit at `~/.config/systemd/user/ai-kit-watch.service`, enabled with `systemctl --user`. To keep it running after you log out and across reboots, user services need _lingering_; `install` tries to enable it for you and, if it can't (it usually needs elevated permissions), prints the one command to run once: `sudo loginctl enable-linger <you>`. Logs go to the journal: `journalctl --user -u ai-kit-watch -f`.
- **macOS** — a launchd agent at `~/Library/LaunchAgents/com.ai-kit.watch.plist` (`RunAtLoad` + `KeepAlive`). It starts at login; on a headless Mac that means a user must be logged in. Logs go to `~/Library/Logs/ai-kit-watch.log` (`tail -f` it).

`install` warns (but doesn't stop) if the current directory isn't a git repo or has no `skills/` directory — a nudge that you're probably not in your AI Kit checkout.

## Third-party skills

Not every skill is yours — some come from other people's repos. AI Kit tracks where they came from so you can update them later when the original author makes changes.

```bash
# Add a third-party skill
ai-kit skill add frontend-design --from anthropics/skills

# Update all third-party skills from their origins
ai-kit skill update

# Update a specific one
ai-kit skill update frontend-design

# Third-party skills are marked in the list
ai-kit list

# Customized a skill? Detach it so update won't overwrite your changes
ai-kit skill detach frontend-design
```

Under the hood this uses [Vercel's skills CLI](https://github.com/vercel-labs/skills) to fetch the skill. `--from` accepts any source format supported by that CLI, including GitHub shorthand like `anthropics/skills` and full URLs like `https://github.com/anthropics/skills`. A `source.json` is saved alongside the `SKILL.md` to record the origin. Running `ai-kit skill detach <name>` removes that `source.json`, converting it to a local skill that `skill update` will skip.

Browse available third-party skills at **[skills.sh](https://skills.sh)**.

## Design

- **Copy, not symlink** — portable across Docker, CI, and tools that don't follow symlinks
- **Merge, not overwrite** — MCP configs are merged into existing JSON/TOML, preserving your other entries
- **Safe per-server merge** — AI Kit only overrides the target-native MCP keys it emits for a given server, preserving unrelated local metadata in that same server entry
- **Secret-free MCP placeholders** — commit `${VAR}` references once, then render them to each harness at install time
- **Agent Skills standard** — `SKILL.md` works across 30+ tools without conversion (Claude global commands are the one exception — the CLI handles it)
- **Local MCP servers** — write your own with [FastMCP](https://github.com/punkpeye/fastmcp), paths resolved automatically at install time

## Using as a template

This repo is designed to be forked:

1. **Fork** this repo to your GitHub
2. **Clone** and run `bun install && bun link`
3. **Delete** the example skills/MCPs/servers (or keep the ones you want)
4. **Add** your own skills, MCPs, and local servers
5. **Commit** and push — your AI toolkit is now versioned and portable

When you set up a new machine, clone your fork and run `ai-kit install all --global` to get everything in place across every supported harness.

## Contributing

PRs welcome. If you add a new install target, drop it in `src/targets/` and register it in `src/install.ts`.

```bash
bun test          # run all tests
bun test --watch  # watch mode
```

## License

[MIT](LICENSE)
