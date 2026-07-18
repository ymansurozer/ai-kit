---
status: open
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

Pure prefactor, no behavior change: extract the per-target facts currently scattered as inline literals and special-cases into one declarative descriptor table, keyed by target name. Each descriptor declares:

- **Config root** (global): Claude `~/.claude`, Codex `~/.codex`, Pi `~/.pi/agent`, OpenCode `~/.config/opencode`.
- **Curated well-known config files** (used by later slices): Claude `settings.json`, `CLAUDE.md`, `keybindings.json`, `statusline-command.sh`, `agents/`, `hooks/`, `output-styles/`; Codex `config.toml`, `AGENTS.md`; Pi `settings.json`, `keybindings.json`; OpenCode `opencode.json`, `AGENTS.md`.
- **MCP-managed destination files**: Codex `config.toml`, OpenCode `opencode.json`, Claude `~/.claude.json` (note: outside Claude's config root), Pi none.
- **Supports MCPs** flag: true for all except Pi — the currently hardcoded Pi carve-outs in the install fan-out and the Pi target move to reads of this flag.
- **Banned config-tree paths** (used by later slices): Claude `commands/` (it's ai-kit's own skill-install output).

Existing target installers keep their signatures; they (and the install fan-out) source their global paths and capability checks from the table instead of inline literals where those literals are per-target facts. This is groundwork only — no new commands, no new behavior.

## Acceptance criteria

- [ ] A single module exports the descriptor table with all four targets and the fields above; the Pi no-MCP special-case in the install flow reads the flag rather than matching on the target name.
- [ ] No user-visible behavior change: `bun test` exits 0 with the existing suite unmodified (except imports/mechanical updates if a test referenced moved literals).
- [ ] `bun run typecheck` exits 0.
- [ ] New unit test asserts the table's shape for all four targets (roots, MCP flag), following the existing pure-function test pattern.

## Blocked by

None - can start immediately.

## Deviations
