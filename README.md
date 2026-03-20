<div align="center">

# ai-kit

**Your AI skills and MCP servers, in one repo.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![Agent Skills](https://img.shields.io/badge/format-Agent%20Skills-8b5cf6.svg)](https://github.com/anthropics/agent-skills)
[![FastMCP](https://img.shields.io/badge/servers-FastMCP-ff6b6b.svg)](https://github.com/punkpeye/fastmcp)

Centralize your [Agent Skills](https://github.com/anthropics/agent-skills) and [MCP](https://modelcontextprotocol.io/) server configs in a single git repo. Install them to **Claude Code**, **Codex**, **Pi**, or **OpenCode** — per-repo or globally — with one command.

</div>

---

## Why

You use multiple AI coding tools. Each has its own config format and file locations. You've got skills scattered across repos, MCP configs copy-pasted between projects, and no single source of truth.

**ai-kit** is a personal monorepo for all of it:

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
│                         ai-kit repo                         │
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
ai-kit add skill writing-style

# Or grab one from the skills.sh ecosystem
ai-kit add skill frontend-design --from anthropics/skills
```

### 3. Add your MCPs

```bash
# Create a new MCP config from template
ai-kit add mcp playwright
```

Then edit `mcps/playwright.json`:

```json
{
  "description": "Browser automation with Playwright",
  "config": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp"]
  }
}
```

### 4. Write your own MCP servers

For services that don't have an MCP server, write one directly in the repo using [FastMCP](https://github.com/punkpeye/fastmcp):

```bash
ai-kit add server image-gen
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

# Cherry-pick what you need
ai-kit install claude --skills writing-style,humanizer --mcps playwright
```

That's it. Commit your repo, and you have a portable, versioned collection of AI skills and MCP configs.

## Where things land

Both skills and MCPs (including local servers) support two install scopes:

- **Per-repo** (default) — installed into the current project directory. Only available when working in that repo.
- **Global** (`--global`) — installed into your home directory. Available in every project.

### Per-repo (default)

| Target | Skills | MCPs |
|--------|--------|------|
| Claude | `.agents/skills/<name>/SKILL.md` | `.mcp.json` |
| Codex | `.agents/skills/<name>/SKILL.md` | `.codex/config.toml` |
| Pi | `.agents/skills/<name>/SKILL.md` | — |
| OpenCode | `.opencode/skills/<name>/SKILL.md` | `opencode.json` |

### Global (`--global`)

| Target | Skills | MCPs |
|--------|--------|------|
| Claude | `~/.claude/commands/<name>.md` | `~/.claude/settings.json` |
| Codex | `~/.agents/skills/<name>/SKILL.md` | `~/.codex/config.toml` |
| Pi | `~/.pi/agent/skills/<name>/SKILL.md` | — |
| OpenCode | `~/.config/opencode/skills/<name>/SKILL.md` | `~/.config/opencode/opencode.json` |

You can mix both — install some skills globally and others per-repo. `ai-kit sync` re-installs to all tracked locations.

## All commands

| Command | What it does |
|---------|-------------|
| `ai-kit install <target>` | Install skills + MCPs to a target |
| `ai-kit install <target> --global` | Install globally instead of per-repo |
| `ai-kit install <target> --skills a,b` | Install only specific skills |
| `ai-kit install <target> --mcps x,y` | Install only specific MCPs |
| `ai-kit list` | List all available skills and MCPs |
| `ai-kit add skill <name>` | Scaffold a new skill |
| `ai-kit add skill <name> --from <source>` | Fetch a skill from the ecosystem |
| `ai-kit add mcp <name>` | Scaffold a new MCP config |
| `ai-kit add server <name>` | Scaffold a local MCP server (FastMCP) |
| `ai-kit update` | Re-fetch all third-party skills |
| `ai-kit update <name>` | Re-fetch a specific third-party skill |
| `ai-kit sync` | Re-install to all previously tracked targets |

## Third-party skills

Not every skill is yours — some come from other people's repos. ai-kit tracks where they came from so you can update them later when the original author makes changes.

```bash
# Add a third-party skill
ai-kit add skill frontend-design --from anthropics/skills

# Update all third-party skills from their origins
ai-kit update

# Update a specific one
ai-kit update frontend-design

# Third-party skills are marked in the list
ai-kit list
```

Under the hood this uses [Vercel's skills CLI](https://github.com/vercel-labs/skills) to fetch the skill. A `source.json` is saved alongside the `SKILL.md` to record the origin.

Browse available third-party skills at **[skills.sh](https://skills.sh)**.

## Design

- **Copy, not symlink** — portable across Docker, CI, and tools that don't follow symlinks
- **Merge, not overwrite** — MCP configs are merged into existing JSON/TOML, preserving your other entries
- **Agent Skills standard** — `SKILL.md` works across 30+ tools without conversion (Claude global commands are the one exception — the CLI handles it)
- **Local MCP servers** — write your own with [FastMCP](https://github.com/punkpeye/fastmcp), paths resolved automatically at install time

## Using as a template

This repo is designed to be forked:

1. **Fork** this repo to your GitHub
2. **Clone** and run `bun install && bun link`
3. **Delete** the example skills/MCPs/servers (or keep the ones you want)
4. **Add** your own skills, MCPs, and local servers
5. **Commit** and push — your AI toolkit is now versioned and portable

When you set up a new machine, clone your fork and run `ai-kit install claude --global` to get everything in place.

## Contributing

PRs welcome. If you add a new install target, drop it in `src/targets/` and register it in `src/install.ts`.

```bash
bun test          # run all tests
bun test --watch  # watch mode
```

## License

[MIT](LICENSE)
