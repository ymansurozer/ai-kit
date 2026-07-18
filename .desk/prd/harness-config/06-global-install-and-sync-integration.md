---
status: open
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

Make config ride the main install flow and the sync/watch loop, completing the one-command machine story. Covers PRD behaviors 1, 2, 3, 10, 11, 14, 15.

- **Global installs include config**: `ai-kit install <target> --global` runs the config phase for that target in addition to skills and MCPs; `ai-kit install all --global` is the complete new-machine setup (behaviors 1, 2). Per-repo installs (no `--global`) never touch config (behavior 3). `--force` threads through (from slice 03).
- **Ordering on shared destination files** (`~/.codex/config.toml`, `~/.config/opencode/opencode.json`, per the descriptor table): the config file is written first, then MCP sections merge into it, and the drift hash is recorded on the final post-merge content — so the next sync does not see ai-kit's own MCP merge as drift (behavior 10). A config-only run (`ai-kit config install`) on these files must also leave a coherent hash: re-run the MCP merge for that file or hash whatever it wrote plus the merge, but consecutive full syncs must report zero self-drift.
- **Pi**: config installs even though Pi receives no MCPs (behavior 11) — the descriptor flag from slice 01, not a name check.
- **Sync/watch**: tracked global installations re-scan the config tree each sync, so added/removed config files propagate under the existing parity rule (behavior 14). Config drift-skips during watch are reported but are not install failures — no backoff (behavior 15).

## Acceptance criteria

- [ ] `install <target> --global` writes config + skills + MCPs; per-repo install leaves config roots untouched (temp-dir tests).
- [ ] For Codex: after a global install, `config.toml` contains both the repo's config content and the MCP sections; an immediate second sync reports zero drift on it.
- [ ] Pi receives config files and no MCP config.
- [ ] A `sync` after adding a new file to the config tree installs it on the tracked global targets; watch's decision path treats a drift-skip as success (no backoff), asserted through the existing pure decision-core tests' pattern.
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [03-drift-aware-overwrite.md](03-drift-aware-overwrite.md)

## Deviations
