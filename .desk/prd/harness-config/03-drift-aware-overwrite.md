---
status: done
completed_at: 2026-07-18
created_at: 2026-07-18
---

## Parent

[00-prd.md](00-prd.md)

## What to build

Replace slice 02's blanket skip-if-exists with drift-aware overwrite. Covers PRD behaviors 7, 8, 9.

- **State schema**: installations gain a per-destination-file content-hash map, recorded on every ai-kit write. Older state files lack the map — that's valid (no migration); absence of a hash for an existing destination means "never written by ai-kit".
- **Install decision per file**: destination missing → write. Destination present and hash matches last-recorded → overwrite freely (behavior 7). Destination present and content differs from last-recorded hash, or no hash recorded (adoption, behavior 8) → skip and report with the reconcile hint ("capture it, or re-run with --force").
- **`--force`**: accepted by `ai-kit config install` (and threaded so slice 06 can accept it on `install <target> --global`); overrides drift, writes the repo version, re-records the hash (behavior 9).
- Every write re-records the hash of the final written content, so consecutive installs are idempotent and never self-report drift.

## Acceptance criteria

- [ ] Fresh destination → written. Unmodified since last install → overwritten silently. Externally modified since last install → skipped with a report naming the file and the reconcile hint. All three outcomes covered by tests through temp-dir roots.
- [ ] A pre-existing destination never written by ai-kit is skipped (adoption rule) and `--force` then writes it and records its hash.
- [ ] Two consecutive `config install` runs with no external changes report zero drift.
- [ ] An old-format state file (no hash map) loads without error and behaves per the adoption rule.
- [ ] `bun test` and `bun run typecheck` exit 0.

## Blocked by

- [02-config-loader-and-install-tracer.md](02-config-loader-and-install-tracer.md)

## Deviations
