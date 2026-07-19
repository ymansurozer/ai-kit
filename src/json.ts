import { readFileSync } from "fs";

/**
 * Parse JSON that already lives in memory, naming its source on a syntax error.
 *
 * A bare `JSON.parse` failure surfaces as an anonymous `SyntaxError: Unexpected
 * token...` — useless when one corrupt file out of many aborts a whole command.
 * This wraps the parse so the thrown message always names `sourcePath` (a file
 * path, or a descriptive label for content that has no single file). `hint` adds
 * a trailing recovery nudge (e.g. how to reset a corrupt state file). Only
 * `SyntaxError` is reformatted; any other error propagates untouched.
 */
export function parseJsonContent(content: string, sourcePath: string, hint?: string): unknown {
  try {
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse JSON file ${sourcePath}: ${err.message}${hint ? ` — ${hint}` : ""}`, {
        cause: err,
      });
    }
    throw err;
  }
}

/**
 * Read and parse a JSON file, naming the path on a syntax error. `hint` adds a
 * trailing recovery nudge. Non-syntax errors (a missing file's ENOENT, a
 * permission error) propagate unchanged.
 */
export function readJsonFile(path: string, hint?: string): unknown {
  return parseJsonContent(readFileSync(path, "utf-8"), path, hint);
}
