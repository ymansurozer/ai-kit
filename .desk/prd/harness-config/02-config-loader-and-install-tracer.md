---
status: done
completed_at: 2026-07-18
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

The tracer bullet: a `config/` mirror tree in the repo and a `ai-kit config install [target|all]` command (default `all`) that ships it. Covers PRD behaviors 4, 12, 13, 25, and the tree-side half of 22.

- **Loader** (the deep module, with a `*From(dir)` variant for tests): scans `config/<target>/` recursively and returns per-target file sets — relative destination path + content. Base tree only in this slice (no overlays, no `${VAR}`; those are later slices layered into this module). A `config/claude/commands/` entry is rejected with an explanatory error (behavior 22, tree side). Unknown directory names under `config/` that aren't targets or `@`-prefixed are reported and skipped.
- **Generic installer**: takes a file set + a config-root directory (from the descriptor table), writes each file, creating parent dirs. **Safety for this intermediate state:** a destination file that already exists is skipped with a report — slice 03 replaces this blanket skip with hash-based drift detection. Returns per-file outcomes (installed / skipped-existing).
- **CLI**: `config` resource namespace following the `skill`/`mcp`/`server` pattern; `ai-kit config install`, `ai-kit config install <target>`, unknown target errors exactly like the existing install command (behavior 25). Empty or absent tree → graceful no-op message (behavior 13).
- **State**: the installation is recorded like other global installs so sync can find it. A file deleted from the tree simply stops being written — no destination deletion (behavior 12; this falls out of the mirror semantics, assert it in a test).

## Acceptance criteria

- [ ] With a fixture tree containing `config/claude/settings.json` and `config/codex/AGENTS.md`, `config install` writes them under the respective config roots (asserted via temp-dir roots in tests, never the real home).
- [ ] An already-existing destination file is left untouched and reported as skipped.
- [ ] `config install claude` touches only Claude's files; `config install nonsense` exits with the unknown-target error; empty tree no-ops with a message.
- [ ] Removing a file from the fixture tree and re-running install leaves the previously installed destination in place (behavior 12).
- [ ] A `config/claude/commands/` entry aborts with an explanatory error.
- [ ] State file records the config installation; `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [01-prefactor-target-descriptor-table.md](01-prefactor-target-descriptor-table.md)

## Deviations

- **Added a `statePath?` test seam to `ConfigInstallOptions`.** The brief specified only `home?`/`configDir?`, but `configInstall` records state via the module-level `STATE_PATH` (derived from the real `homedir()` at import time, not from `options.home`). Without a seam, state tests would write to the real `~/.ai-kit/state.json`, violating the "never touch the real home" rule. Added `statePath?` (defaulting to `STATE_PATH`) and switched to `saveInstallationTo(statePath, ...)`. Real behavior is unchanged; only tests override it.
- **State merge now preserves the `config` flag.** `saveInstallationTo` merges `config: installation.config || prev.config` so a subsequent regular `install <target> --global` (which does not carry `config`) cannot wipe a previously recorded `config: true`. The brief scoped the "only add config:true, never touch skills/mcps" rule to the config-install direction; this extends the same intent to the reverse direction, which is a small merge-logic change beyond the letter of the brief.
