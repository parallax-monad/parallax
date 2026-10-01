import { createHash } from "node:crypto";

/**
 * Computes the canonical fingerprint for the unsigned transaction prepared by
 * the Native provider and consumed by supplementary evidence sources.
 *
 * Keep the unsigned envelope: Evidence Portability uses this exact serialized
 * shape when it independently validates the prepared transaction binding.
 * Native and Trace both call this helper with the same prepared payload.
 */
export function fingerprintPreparedTransaction(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify({ kind: "unsigned", payload: value }))
    .digest("hex")}`;
}
