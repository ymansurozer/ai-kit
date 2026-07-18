---
status: in-progress
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

- **New `stripCodexMcpSections` rather than reusing `removeTomlSection`.** The existing exported `removeTomlSection` leaves an internal `__AI_KIT_TOML_SECTION__` marker line in its output (it exists to feed `mergeTomlSection`'s `.replace`), so it can't be used for a clean capture-time removal. Added a sibling helper in `codex.ts` that reuses the same private `parseTomlSections` machinery, drops the matched line ranges (section + subsections), and trims trailing whitespace like the installer. Byte-preserving early-return when no known name matches.
- **Overlay attribution parses the overlay file directly, not `loadConfigTreeFrom`.** The brief allowed either. Direct parsing is correct for overlay-only JSON/TOML files (no base counterpart): `loadConfigTreeFrom` marks those `overlayReplaced` without extracting keys, which would have failed the "name the key" acceptance for a first-capture settings.json with no base yet. Capture reads raw overlay dirs and reports the overlay file's own top-level keys.
- **Seams added to `ConfigCaptureOptions`:** `mcpsDir`/`serversDir` (drive behavior-19 name resolution via `loadMcpsFrom`/`loadServersFrom`, default `MCPS_DIR`/`SERVERS_DIR`) and `machine`/`statePath` (drive behavior-21, default `resolveMachineFrom(statePath).name`).
- **Empty `mcp: {}` left in captured opencode.json.** When every entry under `mcp` was ai-kit's, the key is left as an empty object rather than deleted — honest in the diff and harmless on re-install. No attempt to distinguish a user-authored empty `mcp` from an emptied one.
- **Managed-file capture normalizes trailing whitespace.** Stripped codex `config.toml` / opencode `opencode.json` are written trimEnd + trailing newline (matching the installer's own writes) instead of strict byte-for-byte, since these are ai-kit-managed files. Non-managed files stay raw `cpSync`.
