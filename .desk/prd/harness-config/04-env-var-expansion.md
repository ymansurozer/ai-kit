---
status: done
completed_at: 2026-07-18
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

`${VAR}` placeholder expansion in config file content at install time. Covers PRD behavior 6.

- The loader expands `${VAR}` occurrences in each config file's content from the process environment before the file set reaches the installer. Unlike MCP placeholders (which are rendered into the target's native format and resolved by the harness at launch), config placeholders are fully materialized at install — harnesses don't resolve `${VAR}` in settings files themselves.
- Any referenced variable that is unset → that file is skipped with a report naming the file and the missing variable(s); other files still install (behavior 6).
- Expansion applies to file content only — not to paths in the tree.
- Drift hashes (slice 03) are computed on the expanded content, so per-machine values produce per-machine hashes and stay consistent on that machine.

## Acceptance criteria

- [ ] A fixture file containing `${TEST_TOKEN}` installs with the value from the environment substituted; the destination contains no placeholder.
- [ ] With the variable unset, that file is skipped and reported (naming the variable) while sibling files install; exit is not a hard failure.
- [ ] Re-running install with the same env reports no drift (hash was taken post-expansion).
- [ ] Pure-function tests for the expansion helper (multiple vars in one file, `${VAR}` adjacent to text, no-placeholder passthrough).
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [02-config-loader-and-install-tracer.md](02-config-loader-and-install-tracer.md)

## Deviations
