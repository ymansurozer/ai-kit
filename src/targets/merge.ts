export function mergeTargetConfig(
  existing: unknown,
  emitted: Record<string, unknown>,
  ownedKeys: string[],
): Record<string, unknown> {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const result = { ...current };

  for (const key of ownedKeys) {
    if (key in emitted) result[key] = emitted[key];
    else delete result[key];
  }

  return result;
}
