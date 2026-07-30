import type { NormalizedKuruEvidence } from "@parallax/moss-bridge";
import { evidenceCompleteness } from "./evidence-completeness.js";
import { executionReason } from "./execution.js";
import type { EconomicBoundaryStatus, RuleResult } from "./types.js";

export function evaluateKuruEvidence(
  evidence: NormalizedKuruEvidence,
): RuleResult {
  const completeness = evidenceCompleteness(evidence);
  const economicBoundary = economicBoundaryStatus(evidence);
  const reason = executionReason(evidence);
  if (evidence.integrationStatus !== "OK") {
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
  if (evidence.executionStatus === "NO_ROUTE") {
    return result(
      evidence,
      completeness,
      economicBoundary,
      "STOP",
      [reason ?? "No route."],
      ["Try another route, protocol, or token pair."],
    );
  }
  if (evidence.executionStatus !== "SUCCESS") {
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
      ["Adjust amount, route, or the explicit acceptance boundary."],
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
  return result(
    evidence,
    completeness,
    economicBoundary,
    "UNKNOWN",
    [
      "No minimum received was supplied, so no economic acceptance decision was inferred.",
    ],
    [],
  );
}

function economicBoundaryStatus(
  evidence: NormalizedKuruEvidence,
): EconomicBoundaryStatus {
  const minimumReceived = evidence.intent.minimumReceived;
  if (minimumReceived === undefined) return "NOT_APPLICABLE";
  const quote = quoteOutput(evidence);
  if (!quote || !decimal(quote) || !decimal(minimumReceived)) return "UNKNOWN";
  return compareDecimal(quote, minimumReceived) >= 0 ? "PASS" : "FAIL";
}

function quoteOutput(evidence: NormalizedKuruEvidence): string | null {
  if (!record(evidence.quote.value)) return null;
  const value = evidence.quote.value.estimatedAmountOut;
  return typeof value === "string" ? value : null;
}

function result(
  evidence: NormalizedKuruEvidence,
  evidenceCompleteness: RuleResult["evidenceCompleteness"],
  economicBoundary: EconomicBoundaryStatus,
  verdict: RuleResult["verdict"],
  reasons: string[],
  actions: string[],
): RuleResult {
  return {
    integrationStatus: evidence.integrationStatus,
    executionStatus: evidence.executionStatus,
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
