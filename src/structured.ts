import { parse as parseTomlContent, stringify as stringifyTomlContent } from "smol-toml";

import { parseJsonContent } from "./json";

/** The two structured config formats ai-kit can parse, merge, and re-emit. */
export type StructuredKind = "json" | "toml";

/**
 * Which structured format a config file is, by extension — `null` for everything
 * else (shell scripts, markdown, binary assets), which ai-kit only ever handles
 * as opaque bytes.
 *
 * The single source of truth for "can this file be treated as key/value data":
 * the overlay deep-merge, install-time `${VAR}` expansion, and capture's
 * overlay-attribution warning all gate on it, so they can never disagree about
 * which files are structured.
 */
export function structuredKind(relPath: string): StructuredKind | null {
  if (relPath.endsWith(".json")) {
    return "json";
  }
  if (relPath.endsWith(".toml")) {
    return "toml";
  }
  return null;
}

/**
 * Parse structured config content as `kind`, naming its source when it is
 * malformed. Follows the labeled-error convention of `parseJsonContent`: the
 * thrown message always names `label` (a file path, or a descriptive label such
 * as `config/@overlay/codex/config.toml` for content with no single file) and
 * `hint` adds a trailing recovery nudge — one corrupt file out of many must say
 * which file it was.
 *
 * Config files are objects at the top level; the cast reflects that contract
 * rather than proving it, matching how the callers have always treated them.
 */
export function parseStructured(
  kind: StructuredKind,
  content: string,
  label: string,
  hint?: string,
): Record<string, unknown> {
  if (kind === "json") {
    return parseJsonContent(content, label, hint) as Record<string, unknown>;
  }
  try {
    return parseTomlContent(content);
  } catch (err) {
    throw new Error(
      `Failed to parse TOML config ${label}: ${err instanceof Error ? err.message : String(err)}` +
        `${hint ? ` — ${hint}` : ""}`,
      { cause: err },
    );
  }
}

/**
 * Serialize parsed config back to text in the shape ai-kit writes everywhere
 * else: two-space JSON with a trailing newline (matching state, MCP configs, and
 * the overlay merge), and smol-toml's rendering for TOML (Bun parses TOML
 * natively but cannot stringify it).
 */
export function stringifyStructured(kind: StructuredKind, value: unknown): string {
  return kind === "json" ? JSON.stringify(value, null, 2) + "\n" : stringifyTomlContent(value);
}
