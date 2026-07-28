import { parseStructured, stringifyStructured, type StructuredKind } from "./structured";

/**
 * Recursively sort object keys so equal parsed content always serializes
 * identically. Arrays keep their order (order is part of an array's value);
 * everything else passes through, including the dates a TOML parse can yield —
 * `JSON.stringify` renders those as their ISO string, which is deterministic and
 * all a hash needs.
 *
 * Tables and objects are recognized by a plain *or* null prototype: smol-toml
 * builds its tables with `Object.create(null)`, and only class instances (dates
 * above all) must fall through untouched.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).toSorted()) {
    sorted[key] = canonicalize(source[key]);
  }
  return sorted;
}

/**
 * `content` minus its machine-owned top-level `keys`, rendered canonically for
 * hashing (PRD: drift compares stripped forms, so churn in owned keys never
 * blocks the rest of a file from syncing).
 *
 * The result is a hashing artifact, never file content: both formats render as
 * key-sorted JSON, so equal parsed content hashes equal regardless of key order
 * or format-specific rendering — a formatting-only local edit stops counting as
 * drift, and TOML needs no re-stringification. `label` names the source in the
 * parse error corrupt content raises; the caller decides how to degrade (an
 * unparseable destination is drift, not a crash).
 */
export function stripOwnedKeys(content: string, keys: string[], kind: StructuredKind, label: string): string {
  const parsed = parseStructured(kind, content, label);
  for (const key of keys) {
    delete parsed[key];
  }
  return JSON.stringify(canonicalize(parsed));
}

/** Source labels for the two sides of a splice, used to name whichever one fails to parse. */
export interface SpliceLabels {
  /** Label for the repo-side content (e.g. `config/claude/settings.json`). */
  repo: string;
  /** Label for the destination content (e.g. `~/.claude/settings.json`). */
  dest: string;
}

/**
 * The repo's content with the destination's *state* for each machine-owned
 * top-level key grafted on — what install writes, so a sync never resets a key
 * the machine owns.
 *
 * "State" includes absence: a key the destination lacks is dropped from the
 * result even when the repo declares it (PRD behavior 4 — sync never re-adds
 * it), so repo values for owned keys only ever seed machines where the file does
 * not exist yet. Non-owned content is the repo's, untouched and in the repo's key
 * order; owned keys the repo lacks are appended. Unlike {@link stripOwnedKeys}
 * the output IS file content, so it is stringified in its own format. A corrupt
 * side raises a parse error naming it via `labels`.
 */
export function spliceOwnedKeys(
  repoContent: string,
  destContent: string,
  keys: string[],
  kind: StructuredKind,
  labels: SpliceLabels,
): string {
  const repo = parseStructured(kind, repoContent, labels.repo);
  const dest = parseStructured(kind, destContent, labels.dest);
  const owned = new Set(keys);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(repo)) {
    if (!owned.has(key)) {
      result[key] = value;
    } else if (key in dest) {
      result[key] = dest[key];
    }
  }
  for (const key of owned) {
    if (key in dest && !(key in repo)) {
      result[key] = dest[key];
    }
  }

  return stringifyStructured(kind, result);
}
