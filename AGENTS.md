# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, and others) when working with code in this repository. `CLAUDE.md` is a symlink to this file.

## What this is

AI Kit is a Bun CLI that centralizes AI skills (Agent Skills standard `SKILL.md`) and MCP server configs in a single repo, then installs them to Claude Code, Codex, Pi, or OpenCode — per-repo or globally.

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
- `claude.ts` — per-repo: `.agents/skills/` + `.mcp.json`; global: `~/.claude/commands/` (frontmatter name stripped) + `~/.claude.json`
- `codex.ts` — per-repo: `.agents/skills/` + `.codex/config.toml`; global: `~/.agents/skills/` + `~/.codex/config.toml`
- `opencode.ts` — per-repo: `.opencode/skills/` + `opencode.json`; global: `~/.config/opencode/skills/` + `~/.config/opencode/opencode.json`
- `pi.ts` — `.agents/skills/` for both per-repo and global installs, skills only, no MCP support
- Targets receive McpConfig objects and write `mcp.config` as-is — no path transformation needed

**Harness config (`config/` tree):**

- `src/targets/descriptors.ts` — one declarative `DESCRIPTORS` table per target: config root path segments, curated well-known files (for capture), mcp-managed destination files, a `supportsMcps` flag (absorbs Pi's carve-out), and banned config paths (Claude's `commands/`). `configRootFor(target, home)` resolves the absolute root. Path literals that used to be scattered across the target installers live here.
- `src/config-tree.ts` — the deep loader. `loadConfigTreeFrom(dir, machine)` scans `config/`, resolves base + `@<machine>` overlay, deep-merges (defu for JSON, smol-toml for TOML — objects merge, arrays/scalars replace; other file types replace wholesale), and returns per-target file sets. `expandEnvVars` / `findPlaceholders` handle `${VAR}`; `summarizeConfigTreeFrom` powers `ai-kit list`'s config section (raw base paths + overlay applicability).
- `src/config-install.ts` — target-agnostic install/drift phase. Expands `${VAR}` (files with unset vars are skipped and reported), then writes with drift-aware overwrite: a destination is overwritten only when its content matches the hash AI Kit last recorded; drifted or never-managed destinations are skipped unless `--force`. `configPhase` runs inside a global `install` before the MCP merge; `finalizeMcpManagedHashes` re-hashes shared files (codex `config.toml`, opencode `opencode.json`) after the MCP merge so the recorded hash covers the final content and the next sync sees no self-drift.
- `src/config-capture.ts` — the reverse direction: copies tracked ∪ curated files from a config root into the base tree, strips AI Kit-rendered MCP sections, and warns on `${VAR}` replacement and overlay-contributed values.
- `src/machine.ts` — `resolveMachineFrom` returns the overlay machine name (state override, else normalized hostname); backs `ai-kit config machine [name]`.

**State (`src/state.ts`):** Tracks all installations in `~/.ai-kit/state.json` keyed by `(target, global, path)`. Enables `ai-kit sync` to re-install everywhere. Installations also carry a `configFiles` per-destination content-hash map (drives config drift detection), and state gains a top-level machine-name override for overlay selection. Older state files lack these fields — no migration needed; the first config-aware install populates them.

**External skills (`src/fetch-skill.ts`):** Uses `bunx skills add` (Vercel skills CLI) in a temp dir, copies result to `skills/<name>/`, writes `source.json` alongside.

## Key design decisions

- **Copy, not symlink** — `cpSync()` everywhere for portability
- **Merge, not overwrite** — MCP configs are merged into existing JSON/TOML, preserving non-AI Kit entries
- **Absolute paths for local servers** — resolved at load time in `loadServersFrom()`, written as-is to target configs
- **Synchronous throughout** — `spawnSync()` for external calls, no async/await in core flow
- **Drift-aware config overwrite** — config files overwrite only when the destination matches AI Kit's last recorded hash; drift is reported, `--force` overrides
- **Expand config `${VAR}` at install, MCP `${VAR}` at launch** — config files are materialized concretely (harnesses don't resolve placeholders in settings); MCP placeholders pass through for the harness to resolve
- **`defu` + `smol-toml`** — the two runtime deps, for config deep-merge and TOML serialization (Bun parses TOML natively but can't stringify it)

## Testing patterns

Bun native test runner. Two patterns:

1. **Pure function tests** — `parseFrontmatter`, `parseFlags`, `tomlString`, `buildTomlSection`, `removeTomlSection`, `convertSkillToCommand`
2. **Temp directory tests** — `mkdtempSync` in `beforeEach`, `rmSync` in `afterEach`. Loading functions and target installers use their `*From(dir)` / `cwd` parameter variants.

## Adding a new install target

1. Create `src/targets/<name>.ts` with `export function install<Name>(skills, mcps, global, cwd)`
2. Register in the `TARGETS` map in `src/install.ts`
3. Add a `DESCRIPTORS` entry in `src/targets/descriptors.ts` (config root, curated files, mcp-managed files, `supportsMcps`, banned paths) so config install/capture/list cover the target
