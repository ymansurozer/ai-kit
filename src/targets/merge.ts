export function mergeTargetConfig(
  existing: unknown,
  emitted: Record<string, unknown>,
  ownedKeys: string[],
): Record<string, unknown> {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  const result: Record<string, unknown> = {};

  // Write owned keys first (preserves declared order)
  for (const key of ownedKeys) {
    if (key in emitted) result[key] = emitted[key];
  }

  // Append non-owned keys from existing config
  for (const key of Object.keys(current)) {
    if (!ownedKeys.includes(key)) result[key] = current[key];
  }

  return result;
}
