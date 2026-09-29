/**
 * `@parallax/sdk` — a thin typed HTTP client for the public Parallax API.
 *
 * Scope and non-goals:
 *
 * - The Backend remains the source of truth for every Product, Risk, Cause, and
 *   Re-run decision.
 * - The SDK performs transport plus canonical `@parallax/contracts` validation.
 * - It contains no Risk rules, no Provider or RPC access, no QuickNode or
 *   Explorer calls, and no signing, broadcasting, or custody.
 */

/**
 * Canonical Contract types used by this surface, re-exported for convenience.
 * They are owned by `@parallax/contracts`; the SDK declares no new semantics.
 */
export type {
  CheckSwapRequest,
  CompletedRunResult,
  FailedRunResult,
  NormalizedSwapIntent,
  ProtocolId,
  QuoteRequest,
  QuoteResult,
  RunResult,
} from "@parallax/contracts";
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
