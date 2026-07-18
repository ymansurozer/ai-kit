---
status: done
completed_at: 2026-07-18
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

Surface the feature everywhere a user discovers ai-kit. Covers PRD behaviors 24 and 26.

- **`ai-kit list`**: a config section showing base files per target, which `@<machine>` overlays exist, and whether each applies to this machine (behavior 24).
- **Help text**: the `config` namespace (`install`, `capture`, `machine`), `--force`, and capture's `--file` documented in `ai-kit --help`, matching the existing hand-maintained help format (behavior 26).
- **README**: a "Centralized harness config" section — the mirror-tree rule with the config-roots table, overlays, `${VAR}` expansion (contrasted with MCP placeholder passthrough), drift/`--force`/capture workflow, the new-machine story (`ai-kit install all --global` now includes config), and the day-one seeding ritual (`ai-kit config capture` on the old machine). Update the commands table, the "zero runtime dependencies" claim (now `defu` + `smol-toml`), and the AGENTS.md architecture notes (new modules, descriptor table, state hash map).

## Acceptance criteria

- [ ] `ai-kit list` on a fixture tree with base files and two overlays (one matching this machine) renders the config section with applicability marked.
- [ ] `ai-kit --help` output includes every new command and flag shipped by slices 02–08.
- [ ] README documents the mirror rule, config-roots table, capture/drift workflow, and new-machine ritual; no remaining "zero runtime dependencies" claim; AGENTS.md architecture section mentions the descriptor table, config loader/installer/capture modules, and the state hash map.
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [06-global-install-and-sync-integration.md](06-global-install-and-sync-integration.md)
- [08-capture-refinements.md](08-capture-refinements.md)

## Deviations

- **Help text was already complete.** `showHelp()` in `src/cli.ts` already documented `config install [target] [--force]`, `config capture [target] [--file p]`, `config machine [name]`, `--force`, and `--file` (added by earlier slices). No gaps to fix; I added three `config` example lines to the Examples block for discoverability (behavior 26) rather than editing the command/flag docs.
- **"Where things land" kept config out of the scope tables.** Config is global-only and mirror-tree (path == destination), so it doesn't fit the per-scope Skills/MCPs columns. Added a prose note + link to the new section instead of forcing a column (brief left this to my judgment).
- **`ai-kit list` config section also names the targets each overlay touches** — a small extra beyond the minimal "which overlays exist + whether they apply", surfaced from the same directory scan.
- **Commands table added three config rows** (`config install`/`capture`/`machine`); the `--force` variant is documented in the new section's prose, not as a fourth table row (brief said "the three config commands").
