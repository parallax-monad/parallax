import { createHash } from "node:crypto";

/**
 * Computes the canonical fingerprint for the unsigned transaction prepared by
 * the Native provider and consumed by supplementary evidence sources.
 *
 * The transaction payload is the shared binding contract. Do not add source-
 * specific wrappers here: Native and Trace must hash the same prepared
 * transaction value byte-for-byte.
 */
export function fingerprintPreparedTransaction(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableJson(value))
    .digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
