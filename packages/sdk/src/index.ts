/**
 * @parallax/sdk — a small typed client for the public Parallax HTTP API.
 *
 * The Backend remains authoritative for Product, Risk, Cause, Provider, and
 * Re-run semantics. This package performs transport and canonical Contract
 * validation only; it never signs, broadcasts, or holds transactions.
 */
export type {
  AccountStateSnapshot,
  CheckSwapRequest,
  FailedRunResult,
  NormalizedSwapIntent,
  ProtocolId,
  QuoteRequest,
  QuoteResult,
  RunResult,
} from "@parallax/contracts";
export { accountStateSnapshotSchema } from "@parallax/contracts";
export {
  type AccountStateRequest,
  ParallaxClient,
  type ParallaxClientOptions,
  type ParallaxFetch,
  type RecheckRequest,
} from "./client.js";
export { ParallaxApiError } from "./errors.js";
export {
  type CheckRunEnvelope,
  checkRunEnvelopeSchema,
} from "./run-envelope.js";
