/**
 * Serializes cross-module payloads while preserving BigInt values as exact
 * decimal strings suitable for JSON and HTTP transport.
 */
export function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, currentValue) =>
    typeof currentValue === "bigint" ? currentValue.toString() : currentValue,
  );

  if (serialized === undefined) {
    throw new TypeError("Top-level value is not JSON serializable");
  }

  return serialized;
}
