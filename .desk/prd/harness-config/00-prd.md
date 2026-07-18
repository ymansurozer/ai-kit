---
status: in-progress
created_at: 2026-07-18
---

## Problem Statement

Skills and MCP configs are centralized in this repo, but the harness config itself — Claude Code's global settings, Codex's config.toml, Pi's settings, global instruction files, keybindings, hooks, statusline — still lives only on each machine. Setting up a new machine means recreating all of it by hand, and existing machines drift apart silently. The one-command promise ("clone the repo, run one install, the machine is ready") stops short of the harness config layer.

## Solution

A new `config/` asset tree in the repo mirrors each harness's global config directory: the path of a file inside `config/<target>/` _is_ its destination path relative to that harness's config root. Anything dropped into the tree ships; per-machine differences are expressed as `@<machine>` overlay deltas deep-merged over the base. Config installs as part of `ai-kit install <target> --global` (so `ai-kit install all --global` remains the complete new-machine ritual and sync/watch propagate config changes automatically), and also via a dedicated `ai-kit config install`. A reverse command, `ai-kit config capture`, copies a machine's live config back into the repo for git-diff review — the day-one seeding path and the drift-reconciliation path in one.

Config roots per target:

| Target   | Config root          |
| -------- | -------------------- |
| Claude   | `~/.claude`          |
| Codex    | `~/.codex`           |
| Pi       | `~/.pi/agent`        |
| OpenCode | `~/.config/opencode` |

## Behaviors

### Install

1. When `ai-kit install <target> --global` runs, every file under `config/<target>/` is written to the corresponding path under that target's config root (recursively — subdirectories like `hooks/` mirror through), in addition to skills and MCPs.
2. When `ai-kit install all --global` runs on a fresh machine, all four harnesses receive their skills, MCPs, and config — the complete machine setup in one command.
3. When installing per-repo (no `--global`), config files are never touched; per-repo installs mean skills + MCPs only, exactly as today.
4. When `ai-kit config install [target|all]` runs (default `all`), only config files are installed — global scope by definition — and the installation is recorded in state the same way.
5. When a machine has overlay files under `config/@<machine>/<target>/`, the installed content is the base file deep-merged with the overlay (JSON and TOML; objects/tables merge recursively, arrays and scalars in the overlay win). For any other file type the overlay file replaces the base wholesale. An overlay file with no base counterpart installs on that machine alone.
6. When a config file contains `${VAR}` placeholders, they are expanded from the machine's environment at install time (unlike MCP placeholders, which pass through for the harness to resolve). If a referenced variable is unset, that file is skipped with a report naming the variable; other files still install.
7. When a destination file was modified since ai-kit last wrote it (drift — e.g. Claude Code wrote a permission grant into settings.json), that file is skipped and reported with a reconcile hint ("capture it, or re-run with --force"); unchanged destinations are overwritten freely.
8. When ai-kit has never written a destination file that already exists (adopting config on an existing machine), it is treated as drift: skipped and reported, requiring `--force` or a prior capture. A destination that doesn't exist installs without ceremony.
9. When `--force` is passed (to `ai-kit config install` or `ai-kit install <target> --global`), drift is overridden and the repo version wins.
10. When config and MCPs both write the same destination file (`~/.codex/config.toml`, `~/.config/opencode/opencode.json`), the config file lands first and MCP sections merge into it after; the recorded content hash covers the final result, so the next sync doesn't see its own MCP merge as drift.
11. When installing Pi, config files install even though Pi gets no MCPs.
12. When a file is deleted from the config tree, it simply stops being managed — subsequent installs neither write nor delete the destination.
13. When the config tree is empty or absent for a target, config install is a graceful no-op for that target (skills/MCPs unaffected).

### Sync & watch

14. When a config change is committed and pushed, every machine running `ai-kit watch` (or a manual `ai-kit sync`) applies it on the next tick to all globally-tracked targets — config rides the existing parity rule and the dynamic "all" selection re-scans the tree, so added and removed config files propagate.
15. When watch's sync hits config drift on some file, it reports the skip and keeps running — drift is not an install failure and does not trigger backoff.

### Capture

16. When `ai-kit config capture` runs with no arguments, every target is captured: files copied from the machine into the base config tree, where the captured set is (files already tracked in the tree) ∪ (that target's curated well-known files that exist on the machine). It prints what was grabbed and what was skipped.
17. When `ai-kit config capture <target>` runs, only that target is captured.
18. When `ai-kit config capture <target> --file <relative-path>` runs, that file (relative to the target's config root) is captured and thereby becomes tracked, even if not on the curated list.
19. When capturing `~/.codex/config.toml` or `~/.config/opencode/opencode.json`, the MCP server sections that ai-kit itself rendered (known from `mcps/` + `servers/`) are stripped before writing the repo copy, so `mcps/` stays the single source of truth for MCP config.
20. When capture would replace a `${VAR}` placeholder in the repo copy with a concrete value, it warns — the nudge to re-placeholder before committing. Capture never reverse-substitutes; git diff is the review layer.
21. When capturing on a machine whose install used an overlay, captured content goes to the base tree, with a warning for each key whose installed value came from the overlay (so a machine-local value isn't silently promoted to every machine).
22. When a curated-list path is runtime state rather than config (Claude's `commands/` — ai-kit's own skill output — plus history, projects, sessions, caches, credentials), capture never grabs it; `~/.claude.json` lives outside the Claude config root and is unreachable by design, and a `config/claude/commands/` entry in the repo tree is rejected with an explanatory error.

### Machine identity

23. When overlays are resolved, the machine name is the normalized hostname (lowercased, `.local` stripped) unless overridden; `ai-kit config machine <name>` stores an override in local state, and `ai-kit config machine` with no argument prints the effective name and its source.

### Listing & errors

24. When `ai-kit list` runs, config files appear as a section — base files per target, plus which overlays exist and whether they apply to this machine.
25. When an unknown target is passed to any config command, the error matches the existing unknown-target behavior.
26. When any of the new commands run, `ai-kit --help` documents them (config namespace, `--force`, capture flags).

## Implementation Decisions

- **Target descriptor table (prefactor).** One declarative table per target: config root, curated well-known files, destination files the MCP installer also writes, and an MCP-support flag that absorbs the currently hardcoded Pi carve-out. Target path literals now scattered across the four target installers move here.
- **Config loader (the deep module).** One function scans the config tree, resolves base + overlay for the effective machine, deep-merges, expands `${VAR}`, and returns per-target file sets (relative path + final content, or a skip reason). All merge/expansion complexity hides behind it. Follows the repo's `*From(dir)` convention for testability.
- **Config installer (generic).** Target-agnostic: takes a file set and a config-root directory, applies the drift check, writes files, returns per-file outcomes (installed / skipped-drift / skipped-missing-var). Because the mirror tree makes targets differ only by root path, this is one module, not four — it does _not_ extend the per-target `(skills, mcps, global, cwd)` installer signature; it runs alongside as a distinct install phase, ordered before MCP merge.
- **Capture module.** Reads tracked ∪ curated files from a config root, strips ai-kit-rendered MCP sections (TOML for Codex, JSON for OpenCode — section names derived from loaded MCP/server configs), computes overlay-attribution warnings, writes into the base tree.
- **State schema bump.** Installations gain a per-destination-file content-hash map; state gains a top-level machine-name override. Older state files simply lack these fields — no migration needed; the first config-aware install populates hashes, and pre-existing destinations surface via the adopt-as-drift rule (behavior 8).
- **Drift hash** = hash of the final written destination content (post-overlay-merge, post-`${VAR}`-expansion, post-MCP-merge where applicable), recomputed and re-recorded on every ai-kit write to that file.
- **Curated well-known files.** Claude: `settings.json`, `CLAUDE.md`, `keybindings.json`, `statusline-command.sh`, `agents/`, `hooks/`, `output-styles/`. Codex: `config.toml`, `AGENTS.md`. Pi: `settings.json`, `keybindings.json`. OpenCode: `opencode.json`, `AGENTS.md`. Curated directories are captured recursively.
- **Dependencies.** `defu` for deep-merge, `smol-toml` for TOML parse/stringify (Bun parses TOML natively but cannot serialize it). This retires the "zero runtime dependencies" README claim — a deliberate, user-confirmed trade.
- **CLI wiring.** `config` becomes a resource namespace (`config install`, `config capture`, `config machine`) following the existing `skill`/`mcp`/`server` pattern; `install`/`sync` thread the config phase through when global.
- **Synchronous throughout**, copy-not-symlink, `log` helper for output — per existing repo conventions.

## Testing Decisions

- Test external behavior through the dir-param seams, never the real home directory: loader via its `*From(dir)` variant against fixture config trees in temp dirs; installer and capture against temp destination roots. This is the repo's established temp-dir pattern (`mkdtempSync` in `beforeEach`).
- Pure-function tests for hostname normalization, overlay deep-merge (JSON and TOML), `${VAR}` expansion, and MCP-section stripping — matching the existing pure-function test pattern (`parseFrontmatter`, `tomlString`, …).
- All four core modules get tests: loader (overlay resolution, expansion, curated lists), installer (all three per-file outcomes; ordering with MCP merge so the hash covers the final file), capture (stripping, placeholder-replacement warning, overlay-attribution warning), state (hash recording, machine override, old-state compatibility).
- CLI wiring is covered indirectly through the command handlers, consistent with how existing commands are tested.

## Out of Scope

- **Uninstall / removal propagation** — deleting a repo config file never deletes the installed copy; there is no `config uninstall` (consistent with ai-kit having no uninstall for skills/MCPs).
- **Per-repo config** — config is global-scope only; `.claude/settings.json`-style project files stay out.
- **Managing `~/.claude.json`** — runtime state, permanently excluded.
- **Reverse-substituting secrets on capture** — git diff plus the placeholder-replacement warning is the review layer.
- **Overlay chains / machine groups** — exactly one overlay (the machine's own) merges over base; no shared "work machines" layers.
- **Plugin/extension installation** for any harness.

## Further Notes

- **Upstream vs fork.** This feature's code ships in the public `ai-kit` template with an empty `config/` tree (`.gitkeep` + README section). Real config lands in the private `ai-kit-personal` fork after merging upstream — personal settings never touch the public repo.
- **Accepted risk: frequent Claude drift.** Claude Code writes permission grants into `settings.json` during normal use, so drift-skips on that file will be routine on active machines. Accepted: watch reports without backoff, and the intended rhythm is periodic `config capture` + commit. If it proves noisy, a per-file "always overwrite" opt-in can be added later.
- **Accepted risk: curated-list staleness.** Harnesses add new config files over time; the curated lists will need occasional updates. Mitigated by `--file` capture for anything not yet listed.
- **Naming.** The originally proposed `ai-kit install global` was dropped deliberately — `--global` already means install scope everywhere in the CLI; `ai-kit install all --global` (existing) plus `ai-kit config install` (new) cover both intents without overloading the word.
- **Pi's config root** (`~/.pi/agent`) was verified against Pi's documentation; Pi documents no global instruction file, so none is on its curated list — the mirror tree still allows adding one if Pi grows support.
