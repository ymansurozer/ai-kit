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

> Requires [Bun](https://bun.sh). Runtime deps are minimal: `defu` + `smol-toml` for config deep-merge and TOML serialization, plus `fastmcp` + `zod` if you write your own local servers.

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

> Config files (below) treat `${VAR}` differently — they're expanded **at install time**, not passed through. See [`${VAR}` expansion](#var-expansion--resolved-at-install-not-launch).

## Centralized harness config

Skills and MCPs are only part of a harness's setup. The rest — Claude Code's `settings.json`, Codex's `config.toml`, global instruction files, keybindings, hooks, statuslines — lives in each tool's config directory, and until now only on the machine you set it up on. AI Kit centralizes that too.

Drop a file into `config/<target>/` and its path inside that folder **is** its destination path relative to the harness's config root:

| Target   | Config root          |
| -------- | -------------------- |
| Claude   | `~/.claude`          |
| Codex    | `~/.codex`           |
| Pi       | `~/.pi/agent`        |
| OpenCode | `~/.config/opencode` |

So `config/claude/settings.json` installs to `~/.claude/settings.json`, and `config/claude/hooks/pre.sh` mirrors through to `~/.claude/hooks/pre.sh`. Subdirectories nest exactly as they land — no per-file mapping to maintain.

Files install faithfully: permission bits carry over (an executable hook stays executable on a fresh machine), and binary files (notification sounds, images) are written byte-for-byte — they're excluded from `${VAR}` expansion and deep-merging, and a binary overlay replaces its base wholesale. `.gitkeep` markers are never installed; they exist only to keep empty tree directories in git.

Config is **global-scope only** and rides the existing install:

```bash
ai-kit config install            # install config for every target
ai-kit config install claude     # just one target
ai-kit install all --global      # skills + MCPs + config together, the full new-machine ritual
```

A per-repo install (`ai-kit install claude`, no `--global`) never touches config — skills and MCPs only, exactly as before.

### Per-machine overlays

Machines differ. Express the delta as an `@<machine>` overlay: files under `config/@<machine>/<target>/` merge over the base tree, on that machine only.

- **JSON and TOML** deep-merge — objects and tables merge recursively; arrays and scalars in the overlay win.
- **Any other file type** is replaced wholesale by the overlay.
- An overlay file with no base counterpart installs on that machine alone.

The machine name is your normalized hostname (lowercased, `.local` stripped). Override it when hostnames collide or aren't stable:

```bash
ai-kit config machine            # print the effective name and where it came from
ai-kit config machine devbox     # pin an overlay name for this machine
```

### `${VAR}` expansion — resolved at install, not launch

Config files support `${VAR}` placeholders too, but they behave **differently** from [MCP placeholders](#where-to-set-the-values): a config `${VAR}` is expanded from your environment **at install time**, then written concretely into the harness's config file — harnesses don't resolve `${VAR}` in their own settings. MCP placeholders, by contrast, pass through untouched and resolve at MCP launch time.

If a referenced variable is unset, that one file is skipped and reported by name; the rest still install. Set it and re-run.

Expansion applies to **`.json` and `.toml` files only** — the data formats harnesses read verbatim. Every other file type installs raw: a shell script's `${var}` is its own runtime syntax, and expanding it at install time would corrupt the script.

### Drift-aware overwrites

AI Kit records a content hash of every config file it writes, and on the next install compares:

- **Unchanged since AI Kit last wrote it** → overwritten freely; the repo wins.
- **Modified out from under it** — drift, e.g. Claude Code wrote a permission grant into `settings.json` — → skipped and reported with a reconcile hint.
- **Already exists but AI Kit has never managed it** (adopting config on an existing machine) → also skipped, treated like drift.

Drift is never resolved automatically. You choose:

```bash
ai-kit config install --force    # the repo version wins, drift and all
ai-kit config capture            # or pull the machine's live config back into the repo
```

### Capturing config back into the repo

`ai-kit config capture` is the reverse direction — it copies a machine's live config into the base tree for git-diff review. It grabs the union of files already tracked in the repo and each target's curated well-known files that exist on the machine.

```bash
ai-kit config capture                          # every target
ai-kit config capture claude                   # one target
ai-kit config capture claude --file mcp.json   # one path, even if not curated (adds it to tracking)
```

Capture never reverse-substitutes secrets — git diff is the review layer — but it warns when a captured value overwrites a `${VAR}` placeholder in the repo copy, so you re-placeholder before committing. It also strips the MCP sections AI Kit itself renders into `config.toml` / `opencode.json`, keeping `mcps/` the single source of truth. `~/.claude.json` and Claude's `skills/` (AI Kit's own skill output) are runtime state, never captured.

### Seeding the repo from an existing machine

Day one, your config already exists on your main machine. Pull it in, review, re-placeholder any secrets, commit:

```bash
ai-kit config capture      # copy live config into config/
git diff                   # review what got grabbed
# swap real tokens / local paths back to ${VAR} placeholders
git commit -am "Seed harness config"
```

From then on a new machine is one command — `ai-kit install all --global` lays down skills, MCPs, and config together — and `ai-kit watch` keeps every machine current as you commit changes.

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
| Claude   | `~/.claude/skills/<name>/SKILL.md`          | `~/.claude.json`                   |
| Codex    | `~/.agents/skills/<name>/SKILL.md`          | `~/.codex/config.toml`             |
| Pi       | `~/.agents/skills/<name>/SKILL.md`          | —                                  |
| OpenCode | `~/.config/opencode/skills/<name>/SKILL.md` | `~/.config/opencode/opencode.json` |

You can mix both — install some skills globally and others per-repo. `ai-kit sync` re-installs to all tracked locations, re-scanning the repo so newly added or removed skills/MCPs propagate.

Harness config is global-only and mirrors `config/<target>/` into each tool's config root (`~/.claude`, `~/.codex`, `~/.pi/agent`, `~/.config/opencode`) — see [Centralized harness config](#centralized-harness-config).

## All commands

| Command                                   | What it does                                 |
| ----------------------------------------- | -------------------------------------------- |
| `ai-kit install <target>`                 | Install skills + MCPs to a target            |
| `ai-kit install <target> --global`        | Install globally instead of per-repo         |
| `ai-kit install all`                      | Fan out to every supported target            |
| `ai-kit install <target> --skills a,b`    | Install only specific skills                 |
| `ai-kit install <target> --mcps x,y`      | Install only specific MCPs                   |
| `ai-kit list`                             | List all available skills, MCPs, and config  |
| `ai-kit config install [target]`          | Install centralized harness config (global)  |
| `ai-kit config capture [target]`          | Copy live machine config into the repo tree  |
| `ai-kit config machine [name]`            | Show or set this machine's overlay name      |
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

On each tick it fetches. When the working tree is clean **and** the branch is strictly behind its upstream, it fast-forwards (`git pull --ff-only`), runs `bun install`, and then reinstalls — to **every** target this machine has already installed, never a subset. The install runs in a **fresh subprocess**, so a pull that changed AI Kit's own code or added a dependency takes effect on that very tick — the long-running watcher never executes stale code. That parity rule matters: a watcher running on several machines reinstalls exactly the set each machine tracks in `~/.ai-kit/state.json`, so no target silently drifts. A global reinstall carries harness config along with skills and MCPs, so committed config changes propagate on the next tick too. Run `ai-kit install all --global` once on a new machine and `watch` keeps all four in step from then on.

Because a full install records its selection as "all" (not a frozen list of skill names), `sync` and `watch` **re-scan the repo every cycle** — so skills and MCPs you _add_ or _remove_ propagate too, not just edits to existing ones. Removal is a real deletion, under a strict ownership contract: **AI Kit deletes only what it recorded installing.** Each run snapshots the exact skills and MCPs it installed, and the next run deletes only those recorded names that are no longer installed. So a skill or MCP you delete from the repo is removed from every synced target — the skill's directory and the MCP's entry in each target's config — while a skill directory you placed by hand or an MCP server you added directly to a target's config was never recorded and is never touched. Config files are exempt: a config file removed from the tree is left in place, which is deliberate ([Centralized harness config](#centralized-harness-config) is drift-aware, not delete-on-remove). A cherry-picked install (`--skills`/`--mcps`) records that explicit selection instead, and a later cherry-picked install only ever _widens_ what a machine syncs (it never narrows an existing "all", so you can't accidentally downgrade a machine to syncing a single skill). To deliberately narrow what a machine syncs, edit its `~/.ai-kit/state.json`.

> **Upgrading from an older version?** State files written before this change stored a frozen list of skill/MCP names, so `sync`/`watch` on those machines won't notice newly _added_ skills. Run `ai-kit install all --global` once after upgrading to rewrite the record to the dynamic "all" selection; from then on additions propagate automatically.
>
> Older state files also predate the install snapshot that drives removals. The first run after upgrading prunes nothing — there's no recorded snapshot yet — and simply records what it installed; from the second run on, removals propagate normally. No upgrade ever deletes anything on its first pass.

Some states are reported and skipped, never resolved automatically:

- **Dirty tree** — if tracked files have uncommitted changes, the sync is skipped so your work is never touched; reported once, then it resumes on its own when the tree is clean again. Untracked files (e.g. WIP skill directories you haven't committed) don't count as dirty — a fast-forward pull coexists with them fine, and a real filename collision surfaces as a pull failure that the backoff path handles.
- **Diverged branch** — if a pull wouldn't fast-forward, it stops and reports; it never merges, rebases, or stashes for you.
- **No upstream / fetch failure** — reported once and retried on later ticks (a laptop going offline won't crash or spam the loop).
- **Install failure** — reported, then backed off rather than retried hot; the next successful sync clears the state.
- **Config drift** — a config destination modified since AI Kit last wrote it (or never managed by AI Kit) is skipped and reported, never overwritten. Drift is not an install failure and doesn't trigger backoff; the fix is `ai-kit config capture` + commit, or `ai-kit config install --force`. Claude Code writing permission grants into `settings.json` makes this routine on active machines — reported, not resolved.

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
- **Agent Skills standard** — `SKILL.md` works across 30+ tools without conversion, including Claude's native personal skills at `~/.claude/skills/`
- **Local MCP servers** — write your own with [FastMCP](https://github.com/punkpeye/fastmcp), paths resolved automatically at install time
- **Mirror tree for config** — a file's path inside `config/<target>/` _is_ its destination under the harness config root; no per-file mapping to maintain
- **Drift-aware config** — config overwrites only when the destination still matches what AI Kit last wrote; drift is reported, never clobbered
- **Capture, not just install** — pull a machine's live config back into the repo for git-diff review, the reverse of install

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
