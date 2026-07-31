# Parallax Product Delivery

## 1. Purpose and ownership boundary

This document defines the product behavior that frontend, API, and demo implementations may present from an evaluated Parallax result. It specifies:

- what the user sees and can understand;
- which public Actions may be displayed;
- how checked, unknown, unchecked, and inapplicable Evidence scope is disclosed; and
- how Product/UI consumes a centrally produced Verdict without generating or changing it.

Product/UI is a presenter and interaction layer. It must consume explicit system status, Verdict, reason codes, Action evaluations, scope, Evidence provenance, and Run relationships from an agreed boundary.

The following remain outside this document:

- Evidence classification and trust decisions;
- Rule evaluation and centralized Verdict aggregation;
- Moss normalization;
- Shared Contract field implementation;
- API serialization; and
- final frontend visual styling.

The Product View Model in Section 12 is a product proposal. It is not the frozen Shared Contract and does not activate runtime behavior.

## 2. Current product boundary

The honest P0 capability currently supported by the reviewed repository work is:

```text
Real recorded Moss/Kuru Evidence
→ normalized and reproducible Evidence
→ conservative Rule evaluation
→ Verdict and Scope Disclosure
→ Recorded Replay
```

The real recorded Fixtures currently demonstrate Evidence capture, normalization, provenance preservation, replay, fail-closed handling, and conservative `UNKNOWN` results. They do not yet demonstrate a verified transaction improvement.

The following complete loop is not proven by a real Fixture:

```text
Cause
→ verified Relevant Action
→ verified Irrelevant Action
→ user modification
→ rerun
→ Previous vs New
```

The mock `NO_ROUTE` Fixture is rule-test input. It may validate code or UI preview behavior, but it must not be presented as a real product result, a real Kuru finding, or proof that the Classification or Action Recommendation Gate has passed.

Current real-result product delivery is therefore limited to conservative Evidence presentation, `UNKNOWN` where required Evidence is incomplete or unresolved, Integration Error isolation, and clearly labeled Recorded Replay. `STOP`, `ADJUST`, public transaction recommendations, and real Previous vs New claims remain available only when their central-policy and Evidence gates are satisfied by a real Run.

## 3. Product state selection

Product/UI selects one top-level state in this order, using fields supplied by the result boundary:

```text
systemStatus = INTEGRATION_ERROR
→ Integration Error state

systemStatus = OK + verdict = UNKNOWN
→ Evidence Unknown state

systemStatus = OK + verdict = STOP
→ Stop state

systemStatus = OK + verdict = ADJUST
→ Adjust state

systemStatus = OK + verdict = PROCEED
→ Proceed state
```

`systemStatus` takes precedence over `verdict`. An Integration Error is not a transaction-risk conclusion even if a compatibility payload carries `verdict = UNKNOWN`.

Product/UI must not calculate, upgrade, downgrade, or infer a Verdict from Warning text, Quote values, raw errors, Action text, colors, icons, missing fields, or other visual assumptions. Natural-language copy is display output, never a machine aggregation input.

## 4. User-facing state semantics

The English copy below is normative implementation copy. A surface may shorten secondary details for space, but must preserve the meaning and prohibited interpretations.

### Integration Error

| Field | Product behavior |
| --- | --- |
| Title | **Check could not be completed** |
| Short explanation | **Parallax could not complete this check because a required integration did not return a usable result. No transaction conclusion was produced.** |
| Primary CTA | `Retry check`, only when the error is retryable. Otherwise `View details`. |
| Optional secondary CTA | `View missing evidence` or `Use recorded replay`, when explicitly available. |
| Actions that may appear | System Recovery Actions only. Transaction adjustments and acceptance-boundary changes must not appear. |
| Prohibited wording | “High risk,” “unsafe,” “failed transaction,” “STOP,” “no route,” or any claim that the transaction itself was evaluated. |

Integration Error means the check was not completed. It is separate from transaction `UNKNOWN`.

### UNKNOWN

| Field | Product behavior |
| --- | --- |
| Title | **More evidence is required** |
| Short explanation | **Parallax could not reach a transaction conclusion because required evidence is missing, incomplete, untrusted, or not yet classifiable.** |
| Primary CTA | `View evidence gaps`. |
| Optional secondary CTA | `Retry check` or `Use recorded replay`, when supplied as a System Recovery Action. |
| Actions that may appear | Verified public Actions only. An empty transaction Action list is expected when no recommendation has passed its gate. System Recovery remains separate. |
| Prohibited wording | “High risk,” “unsafe,” “likely to fail,” “STOP,” or “PROCEED.” `UNKNOWN` is lack of a supported conclusion, not a risk score. |

### STOP

| Field | Product behavior |
| --- | --- |
| Title | **Do not use this transaction path** |
| Short explanation | **Blocking evidence applies to this Intent or transaction path. Review the checked reason before continuing.** |
| Primary CTA | `Review blocking evidence`. |
| Optional secondary CTA | A verified alternative-path Action, if it passed the Action Recommendation Gate; otherwise none. |
| Actions that may appear | Only verified `RELEVANT` Actions in `recommendedActions` and verified `IRRELEVANT` Actions in `irrelevantActions`. |
| Prohibited wording | “The protocol is unsafe,” “all routes are blocked,” or any protocol-wide conclusion. `STOP` applies only to the current Intent or path and checked scope. |

### ADJUST

| Field | Product behavior |
| --- | --- |
| Title | **Adjust the transaction before proceeding** |
| Short explanation | **A verified transaction adjustment may improve this Intent within the checked scope. Review the evidence and rerun the check after making the change.** |
| Primary CTA | The explicit verified transaction-adjustment Action. |
| Optional secondary CTA | `Review evidence`. |
| Actions that may appear | `ADJUST` requires both an explicit centralized-policy entry and an Action Recommendation Gate result that verifies relevance and expected effect. |
| Prohibited wording | Speculative advice; a generic “change slippage” or “change amount” suggestion; or lowering Minimum Received to manufacture `PROCEED`. |

An Acceptance Boundary change is not a transaction improvement and must not be used as the basis for `ADJUST`.

### PROCEED

| Field | Product behavior |
| --- | --- |
| Title | **No blocking evidence found in the checked scope** |
| Short explanation | **Parallax found no blocking evidence within the checks completed for this Intent. Review what was not checked before deciding what to do next.** |
| Primary CTA | `Review checked scope`. Product delivery does not authorize signing or broadcasting a transaction. |
| Optional secondary CTA | `View evidence`. |
| Actions that may appear | Verified informative Actions only if the central policy allows them; an empty list is valid. |
| Prohibited wording | “Safe,” “guaranteed,” “risk-free,” “approved protocol,” “no warnings” without trusted Warning Evidence, or any claim beyond the checked scope. |

`PROCEED` means only that no blocking Evidence was found within the checked scope.

## 5. Reason-code-to-copy mapping

Reason codes are stable machine inputs to product copy. The UI maps codes to approved text; it must not parse natural-language messages to derive Rule status, Action applicability, or Verdict.

### Rule reasons: `P0ReasonCode`

Rule reason = why a Rule failed or could not be evaluated.

| Code | Product copy | Display guidance |
| --- | --- | --- |
| `SIMULATION_COVERAGE_MISSING` | **Required simulation coverage is missing.** | Show the affected action or stage when available. |
| `SIMULATION_HALTED` | **The simulation did not complete successfully.** | Do not infer the cause from a generic halt. |
| `CRITICAL_EVIDENCE_MISSING` | **Required evidence is missing.** | Name only fields explicitly identified by the result. |
| `UNCLASSIFIED_WARNING` | **A warning has not yet been classified.** | Do not translate warning presence directly into transaction risk. |
| `UNEXPLAINED_ASSET_CHANGE` | **An asset change requires further evaluation.** | Do not describe it as harmful or benign without a verified predicate. |
| `EVIDENCE_SOURCE_UNKNOWN` | **The source of required evidence is unknown.** | Keep the affected item in Unknown scope. |
| `EVIDENCE_NOT_REPRODUCIBLE` | **Required evidence could not be reproduced.** | A value alone is not enough to pass the check. |
| `NO_ROUTE_FOUND` | **No route was found for this Intent.** | Public real-result copy is allowed only after the Classification Gate passes with real Evidence. Mock use must say **Mock rule preview: no-route mapping**. |
| `SIMULATED_OUTPUT_UNAVAILABLE` | **The simulated received amount is unavailable.** | A Quote is not a substitute for simulated output. |
| `OUTPUT_BELOW_BOUNDARY` | **The simulated received amount is below Minimum Received.** | Requires valid simulated output and an explicit valid boundary. |
| `OUTPUT_SOURCE_CONFLICT` | **Available output sources do not agree.** | Show Unknown; do not choose a preferred value in Product/UI. |
| `RULE_CLASSIFICATION_NOT_VERIFIED` | **This evidence has not passed the required classification gate.** | Keep the resulting conclusion Unknown. |

### Action reasons: `P0ActionReasonCode`

Action reason = why an Action is relevant, irrelevant, unverified, or recovery-only.

| Code | Product copy | Public-list effect |
| --- | --- | --- |
| `ALTERNATIVE_PATH_VERIFIED` | **A tested alternative path produced a usable result.** | May support a verified `RELEVANT` transaction Action. |
| `OUTPUT_IMPROVEMENT_VERIFIED` | **A rerun verified an output improvement at the same acceptance boundary.** | May support a verified `RELEVANT` transaction Action. |
| `CANNOT_CREATE_MISSING_ROUTE` | **This change cannot create a route where none exists.** | May support a verified `IRRELEVANT` Action. |
| `CHANGES_ACCEPTANCE_BOUNDARY_ONLY` | **This changes the acceptance boundary, not the transaction outcome.** | Never present as an improvement or recommended transaction Action. |
| `EFFECT_NOT_VERIFIED` | **The effect of this change has not been verified.** | Enters neither public Action list. |
| `RESTORES_CHECK_ONLY` | **This Action may restore the check but does not improve the transaction.** | Present only as System Recovery. |

### Applicability reasons: `P0ApplicabilityReasonCode`

| Code | Product copy | Scope placement |
| --- | --- | --- |
| `BOUNDARY_NOT_PROVIDED` | **Minimum Received was not provided for this Intent.** | Not Applicable, provided the normalized boundary explicitly confirms this state. |
| `RULE_PRECONDITION_ABSENT` | **This check does not apply because its required condition is absent.** | Not Applicable. |
| `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT` | **This check was not entered after an earlier terminal result.** | Not Applicable, with the earlier terminal result disclosed. |

### Canonical Integration Error codes

These codes select error-specific support text but never a transaction Verdict.

| Code | Product support text |
| --- | --- |
| `MOSS_UNAVAILABLE` | **The Moss check service is unavailable.** |
| `RPC_UNAVAILABLE` | **The required network provider is unavailable.** |
| `TIMEOUT` | **The check timed out before a usable result was returned.** |
| `UNSUPPORTED` | **This check is not supported for the supplied Intent.** |
| `INVALID_RESPONSE` | **A required integration returned an unusable response.** |
| `INTERNAL_ERROR` | **Parallax encountered an internal error while completing the check.** |

The canonical error payload should preserve `stage`, `code`, `message`, and `retryable` from the agreed Contract mapping. Product/UI displays the approved title and explanation first; raw messages may appear only in technical details and must not drive state selection.

## 6. Public Action display rules

Public transaction Actions and System Recovery Actions are separate product concepts.

### `recommendedActions`

- Contains only Actions with verified applicability `RELEVANT`, `recommendable = true`, supporting Evidence, and a passed Action Recommendation Gate.
- Each Action must identify the Intent field it changes, the verified reason code, and the Evidence or related Run supporting the expected effect.
- The UI must not synthesize missing recommendations from Rule text.

### `irrelevantActions`

- Contains only Actions with verified applicability `IRRELEVANT` and `recommendable = false`.
- These entries explain why a commonly considered change does not address the verified cause.
- They are informational and must not be rendered as disabled recommendations that imply eventual relevance.

### Internal or unverified candidates

- An Action with `UNKNOWN` applicability, missing Evidence, or an unverified effect enters neither public Action list.
- Internal candidates, heuristics, reviewer notes, and raw model suggestions are not user-facing Actions.
- An empty Action list is valid and must remain empty rather than being filled with speculative advice.

### System Recovery Actions

- `RETRY_CHECK`, `VIEW_MISSING_EVIDENCE`, and `USE_REPLAY` restore or explain the checking process.
- They appear in a separate **Check recovery** area, not under transaction adjustment.
- A recovery Action cannot change a Rule result or imply transaction improvement.

### Acceptance Boundary changes

- Changing Minimum Received changes the user's acceptance boundary; it does not improve the transaction.
- It must not appear in `recommendedActions` as a way to obtain `PROCEED`.
- Lowering Minimum Received must never be recommended.
- If a user independently changes this boundary, the product creates a new Intent and new Run.

## 7. Scope Disclosure

Every result includes a compact scope summary near the main state and an expanded Evidence view.

### Compact main-result summary

Use counts and direct labels:

```text
Checked: {count} · Unknown: {count} · Not checked: {count} · Not applicable: {count}
```

If `Unknown > 0`, provide `View evidence gaps`. The compact summary must remain visible for `PROCEED`; the result title alone is not sufficient scope disclosure.

### Expanded Evidence view

| Group | Meaning | Required item details |
| --- | --- | --- |
| Checked | The check ran with trusted, reproducible Evidence and produced a usable Rule result. | Check name, status, concise result, source, stage, Run/Fixture reference, and replay label. |
| Unknown | The check could not support a conclusion. | Reason code, missing or unresolved Evidence, source/reproducibility state, and recovery Action if one exists. |
| Not Checked | The check was in scope but did not run or lacks implementation. | Check name and explicit reason; never imply a pass. |
| Not Applicable | The check legitimately did not apply to this Intent. | Applicability reason code and the absent precondition or terminal stage. |

`Not Applicable` is not a hidden pass. It is included in scope disclosure and is used by central policy only according to the Rule specification.

The UI may say **No trusted warnings were recorded in this Run** only when Warning Evidence has an explicit trusted source and is reproducible. It must not say “no warnings” based on an absent, unknown-source, mock, or non-reproducible Warning field.

Product/UI must not infer `minimumReceivedSource = unavailable` from missing data. The source must be explicit after normalization. Missing or inconsistent source/value combinations must fail closed according to the agreed Contract boundary.

## 8. Current real Fixture presentation

The following presentation is limited to the latest reviewed real recorded Fixtures. Both are Recorded Replay candidates, not current Live checks, and neither supports a public transaction adjustment.

### MON → USDC

**Title:** More evidence is required for this MON → USDC check

**Summary:** The recorded Run captured reproducible Quote, Action, and simulation-stage Evidence. The simulation halted after an unsupported `FlipOrderUpdated` warning, so Parallax cannot reach a transaction conclusion.

| Scope | Product presentation |
| --- | --- |
| Successfully checked | Fixture provenance; Quote and Action capture; simulation attempt; transaction identity matching; trusted recorded warning provenance. |
| Unknown | Execution outcome; warning classification; critical asset-change interpretation; final transaction conclusion. |
| Not checked | Verified economic output against Minimum Received; alternative Action effect; user wallet affordability; real rerun comparison. |
| Not applicable | Approval action for the native-input path, where explicitly reported as absent by the Fixture. Minimum Received evaluation only when the explicit normalized boundary state makes the Rule inapplicable. |

**Allowed CTA:** `View evidence gaps`; optional `Use recorded replay` when replay is available.

**Public Action lists:** `recommendedActions = []`; `irrelevantActions = []`.

**Prohibited causal claims:** Do not claim slippage, route quality, balance, allowance, protocol safety, or a specific transaction change caused or would resolve the result. Do not describe the unsupported warning as proof of failure.

### USDC → MON

**Title:** More evidence is required for this USDC → MON check

**Summary:** The recorded Run captured reproducible Quote, approval, swap Action, simulation coverage, and a generic swap revert. The available Evidence does not establish the revert's cause, so Parallax cannot recommend a transaction change.

| Scope | Product presentation |
| --- | --- |
| Successfully checked | Fixture provenance; Quote and Action capture; approval and swap action coverage; transaction identity matching; recorded revert Evidence and warning provenance. |
| Unknown | Root cause of the generic revert; final execution conclusion beyond the supported Evidence mapping; critical asset-change interpretation; transaction improvement. |
| Not checked | Verified simulated received output against Minimum Received; alternative path; modified transaction rerun; user wallet affordability. |
| Not applicable | Only checks explicitly marked inapplicable by the normalized result. Do not infer inapplicability from missing data. |

**Allowed CTA:** `View evidence gaps`; optional `Use recorded replay` when replay is available.

**Public Action lists:** `recommendedActions = []`; `irrelevantActions = []`.

**Prohibited causal claims:** Do not attribute the revert to balance, allowance, slippage, route availability, token behavior, or protocol behavior. Do not suggest increasing slippage, changing amount, or lowering Minimum Received.

## 9. Live, Replay, and Mock disclosure

Every result or preview has one mandatory mode label near its main title.

| Mode | Label | Explanatory copy | Product authority |
| --- | --- | --- | --- |
| Live | **Live check** | **This result was produced from the current check for this Intent.** | May activate a real user Verdict only when the Contract, central policy, and Evidence gates are satisfied. |
| Replay | **Recorded replay** | **This result reproduces previously recorded real Evidence. It is not a current Live Run.** | Preserves real provenance and may reproduce the recorded result; must not imply current chain or integration state. |
| Mock | **Mock rule preview** | **This preview uses synthetic test input to validate code or UI behavior. It is not a real transaction result.** | Cannot activate a real user Verdict, public transaction recommendation, or real Evidence claim. |

Replay must preserve the original source, stage, block/runtime context, Fixture identity, and recorded/live distinction. Relabeling recorded Evidence as replay must not change its underlying provenance.

Demo presets must be labeled **Demo preset** wherever shown. A preset boundary must not appear to be user-declared or sourced from an original swap. Mock Fixtures and demo presets may exercise states for development, but must remain visually and semantically separate from a user result.

## 10. Minimum Received

### Helper text

Use:

> Minimum Received is the lowest output amount accepted for this Intent. It is an acceptance boundary, not an estimate and not a way to improve the transaction.

### Source labels

| Source | Product label | Meaning |
| --- | --- | --- |
| `original_swap` | **From original swap** | Preserved from the original transaction Intent. |
| `user_declared` | **Set by user** | Explicitly supplied by the user for this Intent. |
| `demo_preset` | **Demo preset** | Synthetic demonstration input; never present it as user-declared. |
| `unavailable` | **Source unavailable** | The normalizer explicitly reports that a usable source is unavailable. Product/UI must not infer this value. |

### Rule behavior

- `NOT_APPLICABLE`: No valid Minimum Received boundary was provided and the normalized result explicitly supplies `BOUNDARY_NOT_PROVIDED` or the equivalent agreed Contract state. Display **Not provided for this Intent**.
- `UNKNOWN`: Simulated received output is unavailable, its source conflicts, Evidence is untrusted, or boundary value/source data is inconsistent. Display the corresponding Rule reason. A Quote is not a substitute.
- `PASS`: Trusted simulated output is at or above the unchanged valid boundary. This passes only the economic Rule; it does not independently produce `PROCEED`.
- `FAIL`: Trusted simulated output is below the unchanged valid boundary. Central policy may produce `ADJUST` only when an explicit policy entry and verified Action recommendation exist. Otherwise it may produce `STOP`, subject to any higher-priority blocking `UNKNOWN`.

Parallax must never recommend lowering Minimum Received to manufacture `PROCEED`. An independently changed boundary creates a new Intent and a new Run; it is not an improvement to the previous transaction.

## 11. Previous vs New

Previous vs New is displayed only for actual related Runs with an explicit relationship. A real comparison includes:

| Field | UI meaning |
| --- | --- |
| Previous Run ID / New Run ID | Identifies the two related checks. |
| Previous Intent / New Intent | Shows exactly which user-controlled fields changed. |
| Relationship | Declares rerun, modified Intent, or verified Action application. |
| Mode and provenance | Distinguishes Live, Recorded Replay, and Mock for each side. |
| Previous / New system status | Prevents an Integration Error from being shown as a transaction change. |
| Previous / New Verdict | Shows centrally produced outcomes only. |
| Rule-result diff | Shows status and reason-code changes by Rule ID. |
| Evidence diff | Shows added, removed, or changed trusted Evidence references. |
| Action applied | Identifies a verified Action and the field it changed, when applicable. |
| Acceptance boundary diff | Makes a changed Minimum Received explicit and prevents it from being described as output improvement. |
| Output diff | Uses comparable trusted simulated outputs only. |

Use the heading **Previous Run vs New Run**. Do not show a comparison for unrelated runs or locally fabricated objects.

Mock before/after data must be labeled **Mock comparison** on both sides and cannot prove causality. No real Action loop or improvement claim may be shown until the Action Recommendation Gate has passed using related real Runs.

## 12. Product delivery interface

The following is a **Product View Model proposal** for frontend consumption. It avoids direct UI binding to raw Moss types. It is not the frozen Shared Contract, API response, or runtime implementation.

```ts
type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

type P0ReasonCode =
  | "SIMULATION_COVERAGE_MISSING"
  | "SIMULATION_HALTED"
  | "CRITICAL_EVIDENCE_MISSING"
  | "UNCLASSIFIED_WARNING"
  | "UNEXPLAINED_ASSET_CHANGE"
  | "EVIDENCE_SOURCE_UNKNOWN"
  | "EVIDENCE_NOT_REPRODUCIBLE"
  | "NO_ROUTE_FOUND"
  | "SIMULATED_OUTPUT_UNAVAILABLE"
  | "OUTPUT_BELOW_BOUNDARY"
  | "OUTPUT_SOURCE_CONFLICT"
  | "RULE_CLASSIFICATION_NOT_VERIFIED";

type P0ActionReasonCode =
  | "ALTERNATIVE_PATH_VERIFIED"
  | "OUTPUT_IMPROVEMENT_VERIFIED"
  | "CANNOT_CREATE_MISSING_ROUTE"
  | "CHANGES_ACCEPTANCE_BOUNDARY_ONLY"
  | "EFFECT_NOT_VERIFIED"
  | "RESTORES_CHECK_ONLY";

type P0ApplicabilityReasonCode =
  | "BOUNDARY_NOT_PROVIDED"
  | "RULE_PRECONDITION_ABSENT"
  | "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT";

type IntegrationErrorCode =
  | "MOSS_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "INVALID_RESPONSE"
  | "INTERNAL_ERROR";

type ProductRunMode = "LIVE" | "RECORDED_REPLAY";

interface IntentSummaryView {
  intentId: string;
  tokenIn: { symbol: string; address?: string };
  tokenOut: { symbol: string; address?: string };
  amountIn: string;
  protocol: string;
  minimumReceived?: {
    value?: string;
    source: "original_swap" | "user_declared" | "demo_preset" | "unavailable";
  };
}

interface EvidenceSummaryView {
  evidenceId: string;
  label: string;
  source: "moss" | "rpc" | "quote" | "external" | "derived" | "mock" | "unknown";
  stage: "quote" | "action" | "simulation" | "normalization" | "unknown";
  reproducible: boolean | "unknown";
  fixtureId?: string;
  blockNumber?: string;
  runtimeVersion?: string;
  summary: string;
}

interface RuleResultView {
  ruleId: "P0-EVIDENCE-001" | "P0-EXECUTION-001" | "P0-ECONOMIC-001";
  status: "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
  reasonCodes: P0ReasonCode[];
  applicabilityReason?: P0ApplicabilityReasonCode;
  evidenceIds: string[];
}

interface ProductActionView {
  actionId: string;
  category: "TRANSACTION_ADJUSTMENT" | "ACCEPTANCE_BOUNDARY_CHANGE";
  label: string;
  applicability: "RELEVANT" | "IRRELEVANT";
  reasonCodes: P0ActionReasonCode[];
  evidenceIds: string[];
  changes: Array<{
    field: "amountIn" | "tokenPair" | "protocol" | "slippage" | "minimumReceived";
    from?: string;
    to: string;
  }>;
}

interface RecoveryActionView {
  actionId: string;
  kind: "RETRY_CHECK" | "VIEW_MISSING_EVIDENCE" | "USE_REPLAY";
  label: string;
  reasonCode: "RESTORES_CHECK_ONLY";
}

interface ScopeItemView {
  checkId: string;
  label: string;
  group: "CHECKED" | "UNKNOWN" | "NOT_CHECKED" | "NOT_APPLICABLE";
  reasonCodes: Array<P0ReasonCode | P0ApplicabilityReasonCode>;
  evidenceIds: string[];
  summary: string;
}

interface ScopeDisclosureView {
  counts: {
    checked: number;
    unknown: number;
    notChecked: number;
    notApplicable: number;
  };
  items: ScopeItemView[];
}

interface RunDiffView {
  previousRunId: string;
  newRunId: string;
  relationship: "RERUN" | "MODIFIED_INTENT" | "VERIFIED_ACTION_APPLIED";
  changedIntentFields: string[];
  previousVerdict: Verdict;
  newVerdict: Verdict;
  changedRuleIds: string[];
  changedEvidenceIds: string[];
  appliedActionId?: string;
  acceptanceBoundaryChanged: boolean;
  comparableOutput?: { previous: string; next: string };
}

interface CompletedProductView {
  kind: "COMPLETED_RESULT";
  systemStatus: "OK";
  mode: ProductRunMode;
  runId: string;
  intent: IntentSummaryView;
  verdict: Verdict;
  rules: RuleResultView[];
  recommendedActions: ProductActionView[];
  irrelevantActions: ProductActionView[];
  recoveryActions: RecoveryActionView[];
  scope: ScopeDisclosureView;
  evidence: EvidenceSummaryView[];
  comparison?: RunDiffView;
}

interface IntegrationErrorProductView {
  kind: "INTEGRATION_ERROR_RESULT";
  systemStatus: "INTEGRATION_ERROR";
  mode: "LIVE";
  runId: string;
  intent: IntentSummaryView;
  error: {
    code: IntegrationErrorCode;
    stage: "quote" | "action" | "simulation" | "normalization" | "unknown";
    message: string;
    retryable: boolean;
  };
  compatibilityVerdict?: "UNKNOWN";
  recoveryActions: RecoveryActionView[];
  recommendedActions: [];
  irrelevantActions: [];
  scope: ScopeDisclosureView;
  evidence: EvidenceSummaryView[];
}

interface MockRulePreviewView {
  kind: "MOCK_RULE_PREVIEW";
  mode: "MOCK_RULE_PREVIEW";
  previewId: string;
  label: "Mock rule preview";
  previewVerdict?: Verdict;
  rules: RuleResultView[];
  scope: ScopeDisclosureView;
  evidence: EvidenceSummaryView[];
  recommendedActions: [];
  irrelevantActions: [];
}

type ProductDeliveryView =
  | CompletedProductView
  | IntegrationErrorProductView
  | MockRulePreviewView;
```

Contract and API owners must confirm field names, versioning, serialization, error preservation, Evidence reference granularity, and compatibility behavior before implementation treats this proposal as stable. Product/UI must still consume the centralized result rather than reproduce Rule or Verdict logic in the adapter.

## 13. Stakeholder handoff

| Stakeholder | Primary review responsibility |
| --- | --- |
| Rei (`rainypilgrimage-beep`) | Rule-to-product semantic accuracy, Action visibility boundaries, Scope Disclosure, unsupported inference |
| Jie (`jzhao0`) | Real Fixture accuracy, Moss Evidence, provenance, Live／Replay／Mock claims, technical feasibility |
| Antony (`antony819`) | Frontend implementability, information hierarchy, interaction and empty states |
| Clare (`brightheartma`) | Targeted review only where the document references API, Shared Contract, Integration Error payload, or Product View Model mapping |

The intended review sequence is:

```text
Rei + Jie
→ resolve semantic and Evidence-boundary comments
→ Antony reviews frontend implementation usability
→ Clare reviews only Contract/API-dependent sections where needed
```

Antony may read and review in parallel. Rei and Jie are the primary acceptance reviewers because this specification is derived from their Rule and Evidence work. Clare's review is targeted to the proposed Product View Model, Integration Error payload, and any Contract/API-dependent mapping; it is not required for unrelated product copy.

The document deliberately leaves the following gates open: real `NO_ROUTE` classification, Action Recommendation and causal rerun proof, simulated-output economic evaluation, Warning classification, critical asset-change classification, external Evidence policy, Shared Contract implementation, and API mapping. Until the relevant gate passes, Product/UI must disclose `UNKNOWN`, omit speculative public Actions, or show an explicitly labeled Mock preview.
