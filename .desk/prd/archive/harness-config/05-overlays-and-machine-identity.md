---
status: done
completed_at: 2026-07-18
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

Per-machine overlays and the machine-identity command. Covers PRD behaviors 5 and 23.

- **Machine identity**: effective machine name = normalized hostname (lowercased, trailing `.local` stripped), unless overridden. `ai-kit config machine <name>` stores the override in local state; `ai-kit config machine` with no argument prints the effective name and whether it came from hostname or override (behavior 23).
- **Overlay resolution in the loader**: files under `config/@<machine>/<target>/` merge over the base tree when `<machine>` matches the effective name. JSON and TOML files deep-merge — objects/tables recursively, overlay arrays and scalars win — using `defu` (JSON) and `smol-toml` for TOML parse/stringify (Bun parses TOML but cannot serialize it; both added as runtime dependencies, a user-confirmed trade). All other file types: overlay replaces base wholesale. Overlay-only files (no base counterpart) install on that machine alone (behavior 5).
- Non-matching `@<other-machine>` directories are ignored on this machine.
- The loader also reports, per file, which top-level keys the overlay contributed — consumed later by capture's attribution warning (slice 08).

## Acceptance criteria

- [ ] The PRD's worked example passes as a test: base `{"model":"opus","env":{"A":"1","B":"2"}}` + overlay `{"model":"sonnet","env":{"B":"9"}}` installs as `{"model":"sonnet","env":{"A":"1","B":"9"}}`.
- [ ] Equivalent deep-merge test passes for a TOML file; a Markdown overlay replaces the base file wholesale; an overlay-only file installs.
- [ ] An overlay for a different machine name has no effect.
- [ ] `config machine dev` overrides hostname; no-arg prints the effective name and source; hostname normalization has pure-function tests (mixed case, `.local` suffix).
- [ ] `defu` and `smol-toml` appear as dependencies; `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [02-config-loader-and-install-tracer.md](02-config-loader-and-install-tracer.md)

## Deviations

- **Overlay-attribution shape (data model for slice 08).** `ConfigFile` gains two optional fields rather than one: `overlayKeys?: string[]` carries the top-level keys an overlay contributed to a deep-merged JSON/TOML file; `overlayReplaced?: boolean` marks a file whose whole content came from the overlay (wholesale non-JSON/TOML replacement or an overlay-only file). They are mutually exclusive, and both are absent on files no overlay touched. Chosen over a single `overlayKeys` covering "all keys" because whole-file replacements (e.g. `.md`) have no parseable keys — a boolean marker is unambiguous for capture's attribution warning.
- **Overlay-only target trees resolve.** The loader iterates all known targets (not only those with a base `config/<target>/` dir), so a `config/@<machine>/pi/…` overlay installs even when the base tree has no `pi/` directory at all — the whole-tree analogue of PRD behavior 5's "overlay file with no base counterpart installs." Banned-path enforcement still applies to these.
- **`loadConfigTree()` (no-arg entry) now resolves the effective machine** via `resolveMachineFrom(STATE_PATH)`, so the real entry point applies overlays; `configInstall` passes its resolved machine to `loadConfigTreeFrom` directly and does not go through it.
