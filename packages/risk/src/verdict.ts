import type { GenericEvidence } from "@parallax/contracts";
import { evidenceCompleteness } from "./evidence-completeness.js";
import { executionReason } from "./execution.js";
import type { EconomicBoundaryStatus, RuleResult } from "./types.js";

/**
 * Deterministic generic Risk evaluation.
 *
 * Same input semantics, rule order, verdicts, reasons and actions as the
 * previous Moss-bound `evaluateKuruEvidence`; only the Evidence input is now
 * provider-agnostic. UNKNOWN is never PROCEED, integration failure is never a
 * protocol verdict, and NO_ROUTE stays a legal terminal STOP.
 *
 * The provider evaluation status, the execution outcome and the Risk verdict
 * stay three independent layers: a verified REVERTED execution is
 * `provider.status=SUCCESS` + `execution.status=REVERTED` while this function
 * still returns verdict UNKNOWN.
 */
export function evaluateEvidence(evidence: GenericEvidence): RuleResult {
  const completeness = evidenceCompleteness(evidence);
  const economicBoundary = economicBoundaryStatus(evidence);
  const reason = executionReason(evidence);
  if (evidence.provider.integrationStatus !== "OK") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "UNKNOWN",
      [
        "Integration evidence is unavailable; this is not a protocol-risk result.",
      ],
      [],
    );
  }
  if (evidence.execution.status === "NO_ROUTE") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "STOP",
      [reason ?? "No route."],
      ["Try another route, protocol, or token pair."],
    );
  }
  if (evidence.execution.status !== "SUCCESS") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "UNKNOWN",
      [reason ?? "Execution is unknown."],
      [],
    );
  }
  if (completeness !== "COMPLETE") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "UNKNOWN",
      ["Critical execution evidence is missing or contains warnings."],
      [],
    );
  }
  if (economicBoundary === "FAIL") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "ADJUST",
      ["Expected output is below the caller-provided minimum received."],
      ["Adjust amount, route, or protocol, then re-run the check."],
    );
  }
  if (economicBoundary === "PASS") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "PROCEED",
      [
        "Checked evidence contains no blocking condition within the supplied boundary.",
      ],
      [],
    );
  }
  if (economicBoundary === "NOT_APPLICABLE") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "PROCEED",
      ["No blocking evidence was found within the checked scope."],
      [],
    );
  }
  return result(
    evidence,
    completeness,
    economicBoundary,
    "UNKNOWN",
    ["The supplied economic acceptance boundary could not be evaluated."],
    [],
  );
}

function economicBoundaryStatus(
  evidence: GenericEvidence,
): EconomicBoundaryStatus {
  const minimumReceived = evidence.intent.minimumReceived;
  const source = evidence.intent.minimumReceivedSource;

  if (source === "unavailable") {
    return minimumReceived === undefined ? "NOT_APPLICABLE" : "UNKNOWN";
  }

  if (minimumReceived === undefined) {
    return source === undefined ? "NOT_APPLICABLE" : "UNKNOWN";
  }

  if (source === undefined) return "UNKNOWN";

  if (source === "demo_preset") {
    return evidence.provenance.mode === "RECORDED_REPLAY"
      ? evaluateBoundary(evidence, minimumReceived)
      : "UNKNOWN";
  }

  if (source === "original_swap" || source === "user_declared") {
    return evaluateBoundary(evidence, minimumReceived);
  }

  return "UNKNOWN";
}

function evaluateBoundary(
  evidence: GenericEvidence,
  minimumReceived: string,
): EconomicBoundaryStatus {
  const quote = quoteOutput(evidence);
  if (!quote || !decimal(quote) || !decimal(minimumReceived)) return "UNKNOWN";
  return compareDecimal(quote, minimumReceived) >= 0 ? "PASS" : "FAIL";
}

function quoteOutput(evidence: GenericEvidence): string | null {
  const value = evidence.quote.value?.estimatedAmountOut;
  return typeof value === "string" ? value : null;
}

function result(
  evidence: GenericEvidence,
  evidenceCompleteness: RuleResult["evidenceCompleteness"],
  economicBoundary: EconomicBoundaryStatus,
  verdict: RuleResult["verdict"],
  reasons: string[],
  actions: string[],
): RuleResult {
  return {
    integrationStatus: evidence.provider.integrationStatus,
    executionStatus: evidence.execution.status,
    evidenceCompleteness,
    economicBoundary,
    verdict,
    reasons,
    actions,
  };
}

function decimal(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightScaled = BigInt(
    `${rightWhole}${rightFraction.padEnd(scale, "0")}`,
  );
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}
