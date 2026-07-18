---
status: open
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

The three capture safeguards that keep the repo canonical and secret-free. Covers PRD behaviors 19, 20, 21.

- **Strip ai-kit-rendered MCP sections** (behavior 19): when capturing `~/.codex/config.toml` or `~/.config/opencode/opencode.json`, remove the MCP server entries ai-kit itself rendered — names derived from the loaded `mcps/` + `servers/` configs — before writing the repo copy, so `mcps/` remains the single source of truth. Codex: TOML section removal (prior art exists in the Codex target's section handling). OpenCode: JSON key removal. MCP entries the user added by hand (names not in `mcps/`/`servers/`) survive capture.
- **Placeholder-replacement warning** (behavior 20): when the existing repo copy contains `${VAR}` at a spot where the captured content now has a concrete value, warn — the nudge to re-placeholder before committing. Capture never reverse-substitutes; git diff is the review layer.
- **Overlay-attribution warning** (behavior 21): on a machine whose install used an overlay, capture still writes to the base tree but warns for each key whose installed value came from the overlay (using the loader's overlay-contribution report from slice 05), so a machine-local value isn't silently promoted to every machine.

## Acceptance criteria

- [ ] Capturing a fixture `config.toml` containing ai-kit-rendered MCP sections plus a hand-added MCP entry and user config yields a repo copy with ai-kit's sections gone and everything else intact; same for OpenCode's JSON.
- [ ] Capture over a repo copy containing `${TEST_TOKEN}` where the machine file has the concrete value emits the placeholder warning; capture without placeholders emits none.
- [ ] On a fixture machine with an overlay-set key, capture warns naming that key, and the base-tree write does not include a spurious overlay file.
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [05-overlays-and-machine-identity.md](05-overlays-and-machine-identity.md)
- [07-capture-basic.md](07-capture-basic.md)

## Deviations
