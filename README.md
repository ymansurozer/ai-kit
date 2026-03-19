# ai-kit

Centralized AI skills and MCP configs in one repo. Install them to Claude Code, Codex, or Pi — per-repo or globally.

Skills use the [Agent Skills](https://github.com/anthropics/agent-skills) standard (`SKILL.md`), which is natively supported by Claude Code, Codex, Pi, Cursor, Gemini CLI, and 30+ other tools.

## Install

```bash
# Clone and link globally
git clone https://github.com/ymansurozer/ai-kit.git ~/Developer/ai-kit
cd ~/Developer/ai-kit
bun install
bun link
```

Requires [Bun](https://bun.sh). Zero runtime dependencies.

## Usage

```bash
# Install all skills + MCPs to a target (per-repo)
ai-kit install claude
ai-kit install codex
ai-kit install pi

# Install globally
ai-kit install claude --global

# Cherry-pick specific skills/MCPs
ai-kit install claude --skills code-review,humanizer --mcps playwright

# List available skills and MCPs
ai-kit list

# Re-sync all tracked installations
ai-kit sync

# Scaffold a new skill or MCP
ai-kit add skill my-skill
ai-kit add mcp my-server
```

## Where things go

### Per-repo (default)

| Target | Skills | MCPs |
|--------|--------|------|
| claude | `.agents/skills/<name>/SKILL.md` | `.mcp.json` |
| codex | `.agents/skills/<name>/SKILL.md` | `.codex/config.toml` |
| pi | `.agents/skills/<name>/SKILL.md` | N/A |

### Global (`--global`)

| Target | Skills | MCPs |
|--------|--------|------|
| claude | `~/.claude/commands/<name>.md` | `~/.claude/settings.json` |
| codex | `~/.agents/skills/<name>/SKILL.md` | `~/.codex/config.toml` |
| pi | `~/.pi/agent/skills/<name>/SKILL.md` | N/A |

## Adding skills

Create a folder under `skills/` with a `SKILL.md`:

```markdown
---
name: code-review
description: Review code for quality, patterns, and potential issues
---

# Code Review

## Steps
1. Read the changed files
2. Analyze for patterns, bugs, security issues
...
```

Or scaffold one with `ai-kit add skill code-review`.

## Adding MCPs

Create a JSON file under `mcps/`:

```json
{
  "description": "Browser automation with Playwright",
  "config": {
    "command": "npx",
    "args": ["-y", "@anthropic/mcp-playwright"]
  }
}
```

Or scaffold one with `ai-kit add mcp playwright`.

The `config` object is written directly into the target's MCP configuration.

## Sync

`ai-kit sync` re-reads the current skills and MCPs from the repo and re-installs to all previously tracked targets. Useful after adding or editing skills — run once to propagate everywhere.

State is tracked in `~/.ai-kit/state.json`.

## Design decisions

- **Copy, not symlink** — more portable across Docker, CI, and tools that don't follow symlinks
- **Merge, don't overwrite** — MCP configs are merged into existing JSON/TOML, preserving non-ai-kit entries
- **Agent Skills standard** — `SKILL.md` format works across 30+ tools without conversion (except Claude global, which uses its own commands format — the CLI handles the conversion)
