---
status: in-progress
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

The reverse direction: `ai-kit config capture` copies live machine config into the repo's base tree for git-diff review — the day-one seeding path and the drift-reconciliation path. Covers PRD behaviors 16, 17, 18, 22.

- `ai-kit config capture` (no args) captures every target; `ai-kit config capture <target>` limits to one (behaviors 16, 17).
- **Captured set per target** = files already tracked in `config/<target>/` ∪ curated well-known files (from the descriptor table) that exist under the machine's config root. Curated directories (`agents/`, `hooks/`, `output-styles/`) capture recursively. Prints what was grabbed and what was skipped (behavior 16).
- `--file <relative-path>` captures a file relative to the target's config root even if not curated, and it thereby becomes tracked (behavior 18).
- **Exclusions** (behavior 22): Claude's `commands/` is never captured (ai-kit's own skill output — banned path from the descriptor table), nor runtime state (curated lists simply don't include history, projects, sessions, caches, credentials); `~/.claude.json` sits outside Claude's config root and is unreachable by construction. `--file` pointing at a banned path errors with the explanation.
- Capture writes into the base tree only (overlay handling is slice 08); it never installs, never touches state hashes.

## Acceptance criteria

- [ ] On a fixture "machine root" containing curated and non-curated files, no-arg capture copies exactly tracked ∪ curated into the repo tree and reports grabbed/skipped (temp-dir tests both sides).
- [ ] `capture <target>` touches only that target's subtree; `capture <target> --file <path>` starts tracking an arbitrary file, and a subsequent no-arg capture refreshes it.
- [ ] A curated directory captures recursively.
- [ ] `--file commands/foo.md` on Claude errors with the explanation; a fixture Claude root's `commands/` is never captured implicitly.
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [02-config-loader-and-install-tracer.md](02-config-loader-and-install-tracer.md)

## Deviations
