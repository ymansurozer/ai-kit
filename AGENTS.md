# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with code in this repository. `CLAUDE.md` is a symlink to this file.

## What this is

ai-kit is a Bun CLI that centralizes AI skills (Agent Skills standard `SKILL.md`) and MCP server configs in a single repo, then installs them to Claude Code, Codex, Pi, or OpenCode — per-repo or globally.

## Commands

```bash
bun test              # run all tests
bun run typecheck     # tsc --noEmit
bun link              # link ai-kit as global CLI command
```

## Architecture

**Entry point:** `src/cli.ts` — parses args via `parseFlags()`, routes to command handlers. Wrapped in `import.meta.main` guard so imports don't trigger side effects.

**Config loading (`src/config.ts`):**
- `loadSkills()` — scans `skills/` for subdirs with `SKILL.md`, parses YAML frontmatter
- `loadMcps()` — combines external MCPs from `mcps/*.json` + local servers from `servers/*/index.ts`
- `loadServersFrom()` — scans `servers/`, generates McpConfig with `command: "bun", args: ["run", "<absolute-path>"]` and `isLocal: true`
- All loading functions have a `*From(dir)` variant for testability

**Install targets (`src/targets/`):**
- Each target exports `install<Target>(skills, mcps, global, cwd)`
- `claude.ts` — per-repo: `.agents/skills/` + `.mcp.json`; global: `~/.claude/commands/` (frontmatter name stripped) + `~/.claude/settings.json`
- `codex.ts` — per-repo: `.agents/skills/` + `.codex/config.toml`; global: `~/.agents/skills/` + `~/.codex/config.toml`
- `opencode.ts` — per-repo: `.opencode/skills/` + `opencode.json`; global: `~/.config/opencode/skills/` + `~/.config/opencode/opencode.json`
- `pi.ts` — skills only, no MCP support
- Targets receive McpConfig objects and write `mcp.config` as-is — no path transformation needed

**State (`src/state.ts`):** Tracks all installations in `~/.ai-kit/state.json` keyed by `(target, global, path)`. Enables `ai-kit sync` to re-install everywhere.

**External skills (`src/fetch-skill.ts`):** Uses `bunx skills add` (Vercel skills CLI) in a temp dir, copies result to `skills/<name>/`, writes `source.json` alongside.

## Key design decisions

- **Copy, not symlink** — `cpSync()` everywhere for portability
- **Merge, not overwrite** — MCP configs are merged into existing JSON/TOML, preserving non-ai-kit entries
- **Absolute paths for local servers** — resolved at load time in `loadServersFrom()`, written as-is to target configs
- **Synchronous throughout** — `spawnSync()` for external calls, no async/await in core flow

## Testing patterns

Bun native test runner. Two patterns:
1. **Pure function tests** — `parseFrontmatter`, `parseFlags`, `tomlString`, `buildTomlSection`, `removeTomlSection`, `convertSkillToCommand`
2. **Temp directory tests** — `mkdtempSync` in `beforeEach`, `rmSync` in `afterEach`. Loading functions and target installers use their `*From(dir)` / `cwd` parameter variants.

## Adding a new install target

1. Create `src/targets/<name>.ts` with `export function install<Name>(skills, mcps, global, cwd)`
2. Register in the `TARGETS` map in `src/install.ts`
