# Parallax Product Delivery

## 1. Purpose and ownership boundary

This document defines the product behavior that frontend, API, and demo implementations may present from an evaluated Parallax result. It specifies:

- what the user sees and can understand;
- which public Actions may be displayed;
- how canonical `checked`, `unknown`, and `not_checked` Scope is disclosed, including a presentation-only Not Applicable label; and
- how Product/UI consumes a centrally produced Verdict without generating or changing it.

Product/UI is a presenter and interaction layer. It must consume explicit system status, Verdict, reason codes, Action evaluations, scope, Evidence provenance, and Run relationships from an agreed boundary.

The following remain outside this document:

- Evidence classification and trust decisions;
- Rule evaluation and centralized Verdict aggregation;
- Moss normalization;
- Shared Contract field implementation;
- API serialization; and
- final frontend visual styling.

The Product View Model in Section 12 is a product proposal. It is not the frozen Shared Contract and does not activate runtime behavior. The merged Evidence implementation and merged PR #3 Rule Methodology remain authoritative for their respective semantics; pending Shared Contract/API work remains a separate implementation source. Future Rule or Contract changes require a Product mapping review.

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

PR #1 is now merged into `main`, so the merged Moss bridge, Risk package, recorded Fixtures, tests, and ADR are the Evidence implementation source of truth. That implementation still exposes a provisional legacy Rule result and free-text Action shape; it does not implement the structured Rule and Action contracts proposed by the Rule Methodology.

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
| Primary CTA | `View evidence gaps` when `Unknown > 0`; otherwise `Review checked scope`. |
| Optional secondary CTA | `Retry check` or `Use recorded replay`, when supplied as a System Recovery Action. |
| Actions that may appear | For a blocking `UNKNOWN`, no public transaction Action is shown. Only applicable System Recovery Actions may be public; both public transaction Action lists remain empty. |
| Prohibited wording | “High risk,” “unsafe,” “likely to fail,” “STOP,” or “PROCEED.” `UNKNOWN` is lack of a supported conclusion, not a risk score. |

### STOP

| Field | Product behavior |
| --- | --- |
| Title | **Do not use this transaction path** |
| Short explanation | **Blocking evidence applies to this Intent or transaction path. Review the checked reason before continuing.** |
| Primary CTA | `Review blocking evidence`. |
| Optional secondary CTA | `Review checked scope`; a verified alternative-path Action may be shown only when the canonical result explicitly permits it. |
| Actions that may appear | Only verified `RELEVANT` Actions in `recommendedActions` and verified `IRRELEVANT` Actions in `irrelevantActions`. A blocking `UNKNOWN` always suppresses transaction Actions. |
| Prohibited wording | “The protocol is unsafe,” “all routes are blocked,” or any protocol-wide conclusion. `STOP` applies only to the current Intent or path and checked scope. |

### ADJUST

| Field | Product behavior |
| --- | --- |
| Title | **Adjust the transaction before proceeding** |
| Short explanation | **A verified transaction adjustment may improve this Intent within the checked scope. Review the evidence and rerun the check after making the change.** |
| Primary CTA | `Apply verified transaction Action`, targeting exactly one `recommendedActions` entry selected by `primaryActionId`. |
| Optional secondary CTA | `Review checked scope`. |
| Actions that may appear | `ADJUST` requires an explicit centralized-policy entry, a verified `ActionGateAttestation`, and at least one public transaction Action. An empty `recommendedActions` list is invalid for `ADJUST` and must fail closed to an application/Contract error rather than inventing advice. |
| Prohibited wording | Speculative advice; a generic “change slippage” or “change amount” suggestion; or lowering Minimum Received to manufacture `PROCEED`. |

An Acceptance Boundary change is not a transaction improvement and must not be used as the basis for `ADJUST`.

### PROCEED

| Field | Product behavior |
| --- | --- |
| Title | **No blocking evidence found in the checked scope** |
| Short explanation | **Parallax found no blocking evidence within the checks completed for this Intent. Review what was not checked before deciding what to do next.** |
| Primary CTA | `Return to transaction` only when normalized origin context is available; otherwise `Review checked scope`. Returning control does not authorize, sign, or broadcast the transaction. |
| Optional secondary CTA | `Review checked scope`. |
| Actions that may appear | No transaction recommendation is implied by `PROCEED`. Verified `irrelevantActions` may be shown as explanatory information; an empty list is valid. |
| Prohibited wording | “Safe,” “guaranteed,” “risk-free,” “approved protocol,” “no warnings” without trusted Warning Evidence, or any claim beyond the checked scope. |

`PROCEED` means only that no blocking Evidence was found within the checked scope. It is not authorization and does not claim safety.

### CTA vocabulary and destination mapping

The following are Product/UI CTA values, not transaction Actions or `SYSTEM_RECOVERY` Action evaluations. A recovery CTA may carry a `recoveryActionId` that resolves to a separate canonical recovery Action; navigation CTAs never enter any Action list.

| User-facing copy | CTA kind | Destination rule |
| --- | --- | --- |
| **Retry check** | `RETRY_CHECK` | Resolves to one applicable `recoveryActions` entry and is allowed only when retry is applicable. |
| **View evidence gaps** | `VIEW_MISSING_EVIDENCE` | Resolves to one applicable recovery entry and is allowed only when the projected evidence-gap destination is non-empty. |
| **Use recorded replay** | `USE_REPLAY` | Resolves to one same-Run replay fallback recovery entry. |
| **View details** | `VIEW_DETAILS` | Opens the details target; it never applies or recommends a transaction change. |
| **Review blocking evidence** | `REVIEW_BLOCKING_EVIDENCE` | Opens the blocking Scope/Evidence view for `STOP`. |
| **Review checked scope** | `REVIEW_CHECKED_SCOPE` | Opens the canonical Scope/Evidence view without changing the Verdict. |
| **Return to transaction** | `RETURN_TO_TRANSACTION` | Uses normalized `origin`; it does not authorize, sign, or broadcast. |
| **Apply verified transaction Action** | `APPLY_TRANSACTION_ACTION` | Exists only as the `ADJUST` primary CTA and resolves to its selected public transaction Action. |

`View evidence gaps`, `Review checked scope`, and `Review blocking evidence` are distinct copy/target pairs even when they open related panels. The adapter must not substitute one destination for another based on display text.

## 5. Reason-code-to-copy mapping

Reason codes are stable machine inputs to product copy. The UI maps codes to approved text; it must not parse natural-language messages to derive Rule status, Action applicability, or Verdict.

The mappings below mirror the merged [P0 Rule and Reason-to-Action specification](https://github.com/parallax-monad/parallax/pull/3) at merge commit `afc3d3e637edd1f373457b57194b4b82e1f3d7fa` (PR #3 head `7d8d407ca9b897b3f3a5db09331c891d9a6474ad`) for frontend implementation. They are repeated here only to define Product copy and presentation. The latest reviewed [Shared Contract/API work](https://github.com/parallax-monad/parallax/pull/4) head is `64da65f95fe0f66f6caeeee0d19c8219f91297bd`; it remains open and not frozen. Future Rule or Contract changes require a corresponding Product mapping review.

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

### Rule applicability reasons: `P0ApplicabilityReasonCode`

Rule applicability is limited to the merged P0 Rule vocabulary. `RULE_PRECONDITION_ABSENT` is a Scope reason, not a Rule applicability reason.

| Code | Product copy | Rule projection |
| --- | --- | --- |
| `BOUNDARY_NOT_PROVIDED` | **Minimum Received was not provided for this Intent.** | Only `P0-ECONOMIC-001 = NOT_APPLICABLE`; projects to canonical Scope `not_checked`. |
| `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT` | **This Rule stage was not entered after an earlier terminal result.** | Only `P0-ECONOMIC-001 = NOT_APPLICABLE`; projects to canonical Scope `not_checked`. |

### Independent Scope reasons

Scope reasons have separate machine semantics and use the closed vocabulary from merged PR #3:

- `REQUIRED_CHECK_INTERRUPTED`, `REQUIRED_EVIDENCE_UNAVAILABLE`, and `CLASSIFICATION_INCOMPLETE` explain Scope `unknown`.
- `PRECONDITION_ABSENT`, `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT`, and `OUTSIDE_P0_SCOPE` explain Scope `not_checked`.

A UI may display **Not Applicable** for a Rule-level `NOT_APPLICABLE` tuple, but the canonical Scope status remains `not_checked` and is counted only under `notChecked`.

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

Public transaction Actions and System Recovery Actions are separate product concepts. The Product adapter consumes canonical `ActionEvaluation` entries; it never creates a recommendation from copy, a Rule reason, or a missing list.

### `recommendedActions`

- Contains only verified `RELEVANT` transaction adjustments with `recommendable = true`, a resolving same-Run `EvidenceRef`, a concrete normalized Intent change, and a `VERIFIED` `ActionGateAttestation`.
- The public Action must identify the addressed Rule, exact field change, unchanged original Economic Boundary, baseline Run, and verification child Run through the attestation summary.
- A blocking `UNKNOWN` suppresses the entire public transaction-action surface. Only applicable System Recovery Actions may be public in that state.
- `ADJUST` requires at least one verified transaction Action. If `recommendedActions` is empty, the adapter must fail closed to an application/Contract error; it must not synthesize a fallback Action.

### `irrelevantActions`

- Contains only verified `IRRELEVANT` Actions with `recommendable = false` and closed `P0ActionReasonCode` values.
- A verified acceptance-boundary Action may appear only as `CHANGES_ACCEPTANCE_BOUNDARY_ONLY`; it never enters `recommendedActions`.
- These entries explain why a commonly considered change does not address the verified cause. They are informational and must not be rendered as disabled recommendations.

### Internal or unverified candidates

- `UNKNOWN`, unverified, mock-supported, missing-attestation, or unresolved candidates enter neither public transaction Action list.
- Internal candidates, heuristics, reviewer notes, and raw model suggestions are not user-facing Actions.
- Empty lists are valid and remain empty. Normative empty-state copy is state-specific:
  - `PROCEED`: **No verified transaction adjustment is needed for this checked scope.**
  - `UNKNOWN`: **No verified transaction adjustment is available because required Evidence is unresolved.**
  - `STOP`: **No verified alternative path is available for this Intent.**
- Public list headings are stable: **Verified changes to review**, **Why other changes do not apply**, and **Check recovery**. Empty rows are explanatory text, never disabled recommendation controls.

### System Recovery Actions

- `RETRY_CHECK`, `VIEW_MISSING_EVIDENCE`, and `USE_REPLAY` restore or explain the checking process and appear in a separate **Check recovery** area.
- Recovery Actions preserve canonical support references: `EvidenceRef`, `ErrorRef`, `ScopeRef`, or a same-Run `ReplayRef` resolving to an explicitly labeled Run-level Replay/Demo fallback descriptor.
- `USE_REPLAY` is hidden when the current result is already `RECORDED_REPLAY` unless a distinct, resolving fallback descriptor is explicitly supplied. An unresolved or absent `ReplayRef` keeps the candidate internal.
- A recovery Action cannot change a Rule result or imply transaction improvement.

The merged Rule Methodology permits verified `SYSTEM_RECOVERY` evaluations inside the canonical machine-level `recommendedActions` collection. The Product adapter partitions those entries into the Product View Model's `recoveryActions` presentation group and leaves verified transaction adjustments in `recommendedActions`. This is a presentation mapping only: it must not drop, duplicate, change the applicability of, or reinterpret any canonical `ActionEvaluation`. The canonical machine collection remains the source; `recommendedActions`, `irrelevantActions`, and `recoveryActions` are Product/UI presentation groups.

### Verified transaction Action lifecycle

A Product transaction Action is renderable only when the canonical baseline Run contains a local Evidence record for a `VERIFIED` `ActionGateAttestation`. The attestation must preserve:

- `baselineRunId` and a terminal `verificationRunId` whose `parentRunId` is the baseline;
- the normalized baseline Intent, including Sender, Recipient, `recipientSource`, and `tokenOut`;
- the exact normalized Intent diff;
- the unchanged original Economic Boundary identity, value, and source;
- dedicated cross-Run Rule and Evidence locators for the child Receipt; and
- `result = VERIFIED`.

The child Run must be terminal, non-mock, `systemStatus = OK`, and satisfy the required child Rule Results and Scope before the baseline Receipt is finalized. Cross-Run locators remain nested provenance; they are not public same-Run `ActionSupportRef` values. Until this attestation exists, the Action remains internal and no Product surface may claim a verified transaction improvement.

### Acceptance Boundary changes

- Changing Minimum Received changes the user's acceptance boundary; it does not improve the transaction.
- Lowering Minimum Received must never be recommended or used to manufacture `PROCEED`.
- If a user independently changes this boundary, the product creates a new normalized Intent and new Run.

## 7. Scope Disclosure

Every finalized result includes a compact Scope summary near the main state and an expanded Evidence view. The canonical Scope has exactly three statuses: `checked`, `unknown`, and `not_checked`.

### Compact main-result summary

Use only canonical counts:

```text
Checked: {count} · Unknown: {count} · Not checked: {count}
```

A Rule-level `NOT_APPLICABLE` is projected into `not_checked`; a UI may show a **Not Applicable** badge on that row, but it is not a fourth Scope status or count. A derived `failed` count may be shown separately because Rule `FAIL` is a checked result, not a clean pass. The compact summary remains visible in every finalized state, not only `PROCEED`.

If `Unknown > 0`, the primary CTA may be `View evidence gaps`. If `verdict = UNKNOWN` but `Unknown = 0`, use `Review checked scope` or `View details`; never point to an empty evidence-gap view.

### Expanded Evidence view

| Canonical Scope status | Meaning | Required item details |
| --- | --- | --- |
| Checked | The Rule or Check ran and produced a usable result. A Rule `FAIL` is still `checked`, but must render status `FAIL` and must not look like a clean pass. | Subject ID, status, concise result, source/stage summary supplied by the adapter, Run/Fixture reference, replay label, and Evidence references. |
| Unknown | A required Rule or Check was missing, incomplete, unreliable, unsupported, unclassified, not reproducible, or interrupted before a trustworthy conclusion. | Closed Rule or Scope reason code, unresolved Evidence references, source/reproducibility state, and applicable recovery Action. Unknown must be visually distinct from Not checked. |
| Not checked | The product/P0 capability was not performed in this checked scope, or a trusted terminal result legitimately prevented entry. This includes Rule `NOT_APPLICABLE` projections. | Closed Scope reason, optional Rule applicability reason, and the absent precondition or trusted terminal stage. It never implies a Rule pass. |

A required check that did not successfully run is `unknown`, not `not_checked`. Product/UI must not move it to `not_checked` to avoid a blocking Rule `UNKNOWN`.

`PRECONDITION_ABSENT` belongs to the independent Scope reason vocabulary. `P0ApplicabilityReasonCode` remains limited to `BOUNDARY_NOT_PROVIDED` and `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT`. Product/UI presents the derived categories but does not redefine central Verdict behavior.

Every Scope item uses a stable subject: a P0 Rule ID or one of `P0-CHECK-ACTION-001`, `P0-CHECK-SIMULATION-001`, and `P0-CHECK-SIMULATION-COVERAGE-001`. Rule-bound Scope must agree mechanically with its Rule Result. Rule-bound unknown items use a Rule-specific `ruleReasonCode` plus a closed Scope `scopeReasonCode`; they never reuse a generic `P0ReasonCode` as a Scope reason. The independent Check IDs must never be serialized as Rule Results.

Expanded Scope uses a stable adapter order: Unknown first, then checked Rule `FAIL`, then other checked items, then not checked. The initial and reset state is fully expanded with all items visible; a surface may persist a user-selected collapse only after rendering all items once, must keep Unknown and checked `FAIL` rows expanded by default, and must expose an explicit **Show all scope items** control whenever any rows are collapsed. No item may be silently capped or truncated.

The UI may say **No trusted warnings were recorded in this Run** only when Warning Evidence has an explicit trusted source and is reproducible. It must not say “no warnings” based on absent, unknown-source, mock, or non-reproducible data.

Product/UI must not infer `minimumReceivedSource = unavailable` from missing data. The source must be explicit after normalization. Missing or inconsistent source/value combinations fail closed according to the Contract boundary.

## 8. Current real Fixture presentation

The following presentation is limited to the latest reviewed real recorded Fixtures. Both are Recorded Replay candidates, not current Live checks, and neither supports a public transaction adjustment or verified Action Gate attestation.

### MON → USDC

**Title:** More evidence is required for this MON → USDC check

**Summary:** The recorded Run captured reproducible Quote, Action, and simulation-stage Evidence. The simulation halted after an unsupported `FlipOrderUpdated` warning, so Parallax cannot reach a transaction conclusion.

| Scope | Product presentation |
| --- | --- |
| Successfully checked | Fixture provenance; Quote and Action capture; simulation attempt; transaction identity matching; trusted recorded warning provenance. A Rule `FAIL` is not implied by these checked items. |
| Unknown | Execution outcome; warning classification; critical asset-change interpretation; final transaction conclusion. |
| Not checked | Alternative Action effect; user wallet affordability; real rerun comparison; downstream stage Checks not entered by a trusted terminal result. |
| Not Applicable label | Only when the normalized result supplies the corresponding Rule applicability tuple; the canonical Scope status remains `not_checked`. |

**Allowed CTA:** `View evidence gaps`; optional `Use recorded replay` only when a same-Run Replay fallback descriptor and `ReplayRef` exist.

**Public Action lists:** `recommendedActions = []`; `irrelevantActions = []`; recovery Actions are separate.

**Prohibited causal claims:** Do not claim slippage, route quality, balance, allowance, protocol safety, or a specific transaction change caused or would resolve the result. Do not describe the unsupported warning as proof of failure.

### USDC → MON

**Title:** More evidence is required for this USDC → MON check

**Summary:** The recorded Run captured reproducible Quote, approval, swap Action, simulation coverage, and a generic swap revert. The available Evidence does not establish the revert's cause, so Parallax cannot recommend a transaction change.

| Scope | Product presentation |
| --- | --- |
| Successfully checked | Fixture provenance; Quote and Action capture; approval and swap action coverage; transaction identity matching; recorded revert Evidence and warning provenance. |
| Unknown | Root cause of the generic revert; final execution conclusion beyond the supported Evidence mapping; critical asset-change interpretation; transaction improvement. |
| Not checked | Alternative path; modified transaction rerun; user wallet affordability; downstream stage Checks not entered by a trusted terminal result. |
| Not Applicable label | Only when the normalized result supplies the corresponding Rule applicability tuple; the canonical Scope status remains `not_checked`. Do not infer inapplicability from missing data. |

**Allowed CTA:** `View evidence gaps`; optional `Use recorded replay` only when a same-Run Replay fallback descriptor and `ReplayRef` exist.

**Public Action lists:** `recommendedActions = []`; `irrelevantActions = []`; recovery Actions are separate.

**Prohibited causal claims:** Do not attribute the revert to balance, allowance, slippage, route availability, token behavior, or protocol behavior. Do not suggest increasing slippage, changing amount, or lowering Minimum Received.

## 9. Live, Replay, and Mock disclosure

Every finalized result or preview has one mandatory mode label near its main title. Pending/loading is an application state, not a finalized Run Receipt.

| Mode | Label | Explanatory copy | Product authority |
| --- | --- | --- | --- |
| Live | **Live check** | **This result was produced from the current check for this Intent.** | May activate a real user Verdict only when the Contract, central policy, and Evidence gates are satisfied. |
| Recorded Replay | **Recorded replay** | **This result reproduces previously recorded real Evidence. It is not a current Live Run.** | Preserves real provenance and may reproduce the recorded result; must not imply current chain or integration state. |
| Demo | **Demo preset** | **This result uses an explicitly labeled Demo/Replay preset. It is not a user-declared boundary or current Live Evidence.** | May exercise a product state for demonstration only; it cannot be presented as current Live Evidence. |
| Mock | **Mock rule preview** | **This preview uses synthetic test input to validate code or UI behavior. It is not a real transaction result.** | Cannot activate a real user Verdict, public transaction recommendation, or real Evidence claim. |

`MockRulePreviewView.kind = "MOCK_RULE_PREVIEW"` is the only Mock Preview discriminator. Mock Preview is not a `ProductRunMode`, must not be labeled `LIVE`, `RECORDED_REPLAY`, or `DEMO`, and its Evidence and Scope provenance use `authority = "MOCK"`, `mode = "MOCK_PREVIEW"`, and `previewId`. It cannot be serialized as a finalized user Run, and it has no public transaction or recovery Action surface.

Replay preserves the original Evidence source, stage, block/runtime context, Fixture identity, and recorded/live distinction. A Run-level `ReplayFallbackDescriptor` must identify its fallback mode and source. Relabeling recorded Evidence as replay must not change underlying provenance. An Integration Error uses the same `ProductRunMode` as the underlying finalized Run because loading, parsing, or reproducing a Recorded Replay/Demo can also fail; `LIVE` therefore means a Live integration failure, while `RECORDED_REPLAY` and `DEMO` retain their explicit non-Live labels. The proposal does not invent a second replay-error state.

Demo presets must remain visually and semantically separate from user results. `demo_preset` may never appear as `original_swap` or `user_declared`. Mock Evidence is never core Verdict Evidence.

`PendingProductView` is deliberately not a partial Receipt: it has no Verdict, Rule Results, Scope Disclosure, Evidence collection, Action list, or Replay fallback. Product/UI must not stream partial Scope or Evidence into a finalized state, and a progress indicator must not be treated as a provisional Verdict. An adapter may fetch or evaluate incrementally internally, but it exposes only the terminal Completed or Integration Error projection once the Run is finalized.

## 10. Minimum Received

### Helper text

Use:

> Minimum Received is the lowest output amount accepted for this Intent. It is an acceptance boundary, not an estimate and not a way to improve the transaction.

### Source labels

| Source | Product label | Meaning |
| --- | --- | --- |
| `original_swap` | **From original swap** | Preserved from the original normalized transaction Intent. |
| `user_declared` | **Set by user** | Explicitly supplied by the user for this Intent. |
| `demo_preset` | **Demo preset** | Synthetic demonstration input; never present it as user-declared. |
| `unavailable` | **Source unavailable** | The normalizer explicitly reports that a usable source is unavailable. Product/UI must not infer this value. |

### Rule behavior

- `NOT_APPLICABLE`: No valid Minimum Received boundary was provided and the normalized result explicitly supplies `BOUNDARY_NOT_PROVIDED`. Product projects this Rule tuple to canonical Scope `not_checked` with Scope reason `PRECONDITION_ABSENT`; it must not invent a separate canonical `not_applicable` status.
- `UNKNOWN`: Simulated received output is unavailable, its source conflicts, Evidence is untrusted, or boundary value/source data is inconsistent. Display the corresponding Rule reason. A Quote is not a substitute.
- `PASS`: Trusted simulated output is at or above the unchanged valid boundary. This passes only the economic Rule; it does not independently produce `PROCEED`.
- `FAIL`: Trusted simulated output is below the unchanged valid boundary. Central policy may produce `ADJUST` only when an explicit policy entry and verified Action Recommendation Gate lifecycle exist. Otherwise it may produce `STOP`, subject to any higher-priority blocking `UNKNOWN`.

Parallax must never recommend lowering Minimum Received to manufacture `PROCEED`. An independently changed boundary creates a new normalized Intent and a new Run; it is not an improvement to the previous transaction.

## 11. Previous vs New

Previous vs New is displayed only for actual related Runs with an explicit relationship. It may compare a Completed Receipt with an Integration Error Receipt, but never an in-flight result or fabricated local object. Each side supplies its own indexed Evidence view so removed Evidence can render its label, source, stage, and provenance rather than only a raw identifier.

A real comparison includes:

| Field | UI meaning |
| --- | --- |
| Previous Run ID / New Run ID | Identifies the two related terminal Receipts. |
| Previous Intent / New Intent | Shows normalized Sender, Recipient, `recipientSource`, `tokenOut`, and exactly which user-controlled fields changed. |
| Exact Intent diff | Shows required before/after snapshots, including explicit present/absent states, not a free-form field-name list. |
| Relationship | Declares rerun, modified Intent, or verified Action application. |
| Previous / New status and system status | Distinguishes Completed from Integration Error. |
| Previous / New mode and run provenance | Shows Live, Recorded Replay, Demo, or Mock presentation context, plus timestamp/runtime/block context where available. |
| Previous / New Verdict | Shows centrally produced outcomes only; Integration Error remains `UNKNOWN`. |
| Rule-result diff | Shows legal status and reason-code changes by `P0RuleId`. |
| Evidence diff | Shows added, removed, or changed trusted Evidence references. |
| Action applied | Identifies a verified Action and its attestation when applicable. |
| Acceptance boundary diff | Makes a changed Minimum Received explicit and prevents it from being described as output improvement. |
| Output diff | Uses comparable trusted simulated outputs only. |

Use the heading **Previous Run vs New Run**. No comparison is shown for unrelated runs. Mock before/after data must be labeled **Mock comparison** on both sides and cannot prove causality. No real Action loop or improvement claim may be shown until the Action Recommendation Gate lifecycle has passed. The Evidence diff has separate added, removed, and changed ID sets: each set is unique, the sets are pairwise disjoint, added IDs resolve in the New Run index, removed IDs resolve in the Previous Run index, and changed IDs resolve in both. Reordering alone is not a change. An Evidence diff is descriptive and never changes Verdict or Rule semantics.

## 12. Product delivery interface

The following is a **Product View Model proposal** for frontend consumption. It avoids direct UI binding to raw Moss types. It is not the frozen Shared Contract, API response, or runtime implementation. Repeated types mirror merged PR #3 and must be re-reviewed whenever the Rule or Contract source changes.

The adapter must preserve the following authority boundaries:

The latest reviewed PR #4 contract (`64da65f95fe0f66f6caeeee0d19c8219f91297bd`) currently defines normalized `recipient`, `recipientSource`, and `protocol` on `NormalizedSwapIntent`, alongside discriminated native/ERC-20 asset references. It does not yet define normalized `slippage`; the optional Product field remains a proposal-only extension point until that Contract decision is frozen.

- canonical Rule tuples and Scope subjects are validated before this view is constructed;
- `P0-ECONOMIC-001` is the only Rule that can carry the legal terminal-stage `NOT_APPLICABLE` tuple;
- Rule `NOT_APPLICABLE` projects to Scope `not_checked`, never a second canonical Scope status;
- the two Economic applicability-to-Scope pairs are exhaustive: `BOUNDARY_NOT_PROVIDED` with `PRECONDITION_ABSENT`, or `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT` with the identically named Scope reason;
- `source = mock` Evidence cannot support a completed user `PROCEED`, `ADJUST`, or `STOP`, a Rule `PASS`/`FAIL`, or a public transaction Action;
- transaction Actions require a local `ActionGateAttestation` EvidenceRef and the complete child-Run lifecycle; and
- recovery Actions use canonical support references, including same-Run `ReplayRef` for `USE_REPLAY`.

```ts
type Verdict = "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

type P0RuleId =
  | "P0-EVIDENCE-001"
  | "P0-EXECUTION-001"
  | "P0-ECONOMIC-001";

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
  | "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT";

type P0ScopeCheckId =
  | "P0-CHECK-ACTION-001"
  | "P0-CHECK-SIMULATION-001"
  | "P0-CHECK-SIMULATION-COVERAGE-001";

type P0ScopeUnknownReasonCode =
  | "REQUIRED_CHECK_INTERRUPTED"
  | "REQUIRED_EVIDENCE_UNAVAILABLE"
  | "CLASSIFICATION_INCOMPLETE";

type P0ScopeNotCheckedReasonCode =
  | "PRECONDITION_ABSENT"
  | "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT"
  | "OUTSIDE_P0_SCOPE";

type P0ScopeSubjectId = P0RuleId | P0ScopeCheckId;
type P0EvidenceUnknownReasonCode =
  | "SIMULATION_COVERAGE_MISSING"
  | "SIMULATION_HALTED"
  | "CRITICAL_EVIDENCE_MISSING"
  | "UNCLASSIFIED_WARNING"
  | "UNEXPLAINED_ASSET_CHANGE"
  | "EVIDENCE_SOURCE_UNKNOWN"
  | "EVIDENCE_NOT_REPRODUCIBLE"
  | "OUTPUT_SOURCE_CONFLICT";
type P0ExecutionUnknownReasonCode = "RULE_CLASSIFICATION_NOT_VERIFIED";
type P0EconomicUnknownReasonCode = "SIMULATED_OUTPUT_UNAVAILABLE";

type IntegrationErrorCode =
  | "MOSS_UNAVAILABLE"
  | "RPC_UNAVAILABLE"
  | "TIMEOUT"
  | "UNSUPPORTED"
  | "INVALID_RESPONSE"
  | "INTERNAL_ERROR";

type IntegrationErrorStage =
  | "quote"
  | "action"
  | "simulation"
  | "normalization"
  | "unknown";

type ProductRunMode = "LIVE" | "RECORDED_REPLAY" | "DEMO";
type EvidenceSource = "moss" | "rpc" | "quote" | "external" | "derived" | "mock" | "unknown";
type EvidenceStage = "discover" | "load" | "quote" | "action" | "simulation" | "normalization" | "unknown";

type ProductCopyKey = string;

interface OriginContextView {
  surfaceId: string;
  returnUrl?: string;
  callbackId?: string;
  callerId?: string;
}

type IntentAssetView =
  | {
      kind: "native";
      symbol: string;
    }
  | {
      kind: "erc20";
      symbol: string;
      address: string;
    };

type IntentValueSnapshot =
  | { availability: "PRESENT"; value: string }
  | { availability: "ABSENT" };

type MinimumReceivedView =
  | {
      availability: "available";
      value: string;
      source: "original_swap" | "user_declared" | "demo_preset";
    }
  | {
      availability: "unavailable";
      source: "unavailable";
    };

interface IntentSummaryView {
  intentId: string;
  sender: string;
  recipient: string;
  recipientSource: "explicit" | "defaulted_from_sender";
  tokenIn: IntentAssetView;
  tokenOut: IntentAssetView;
  amountIn: string;
  protocol: string;
  // Optional until the Shared Contract carries normalized slippage. Product/UI must not infer it.
  slippage?: IntentValueSnapshot;
  minimumReceived: MinimumReceivedView;
  origin?: OriginContextView;
}

interface RunProvenanceView {
  runId: string;
  createdAt: string;
  mode: ProductRunMode;
  fixtureId?: string;
  blockNumber?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
}

interface RealEvidenceSummaryView {
  evidenceId: string;
  label: string;
  source: Exclude<EvidenceSource, "mock">;
  stage: EvidenceStage;
  reproducible: "yes" | "no" | "unknown";
  authority: "CORE" | "SUPPLEMENTARY";
  runId: string;
  mode: ProductRunMode;
  fixtureId?: string;
  blockNumber?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
  summary: string;
}

interface MockEvidenceSummaryView {
  evidenceId: string;
  label: string;
  source: "mock";
  stage: EvidenceStage;
  reproducible: "yes" | "no" | "unknown";
  authority: "MOCK";
  previewId: string;
  mode: MockPreviewMode;
  fixtureId?: string;
  summary: string;
}

type EvidenceSummaryView = RealEvidenceSummaryView | MockEvidenceSummaryView;

type EvidenceRuleResultView =
  | {
      ruleId: "P0-EVIDENCE-001";
      status: "PASS";
      reasonCode?: never;
      applicabilityReasonCode?: never;
      evidenceIds: NonEmpty<string>;
    }
  | {
      ruleId: "P0-EVIDENCE-001";
      status: "UNKNOWN";
      reasonCode:
        | "SIMULATION_COVERAGE_MISSING"
        | "SIMULATION_HALTED"
        | "CRITICAL_EVIDENCE_MISSING"
        | "UNCLASSIFIED_WARNING"
        | "UNEXPLAINED_ASSET_CHANGE"
        | "EVIDENCE_SOURCE_UNKNOWN"
        | "EVIDENCE_NOT_REPRODUCIBLE"
        | "OUTPUT_SOURCE_CONFLICT";
      applicabilityReasonCode?: never;
      evidenceIds: string[];
    };

type ExecutionRuleResultView =
  | {
      ruleId: "P0-EXECUTION-001";
      status: "PASS";
      reasonCode?: never;
      applicabilityReasonCode?: never;
      evidenceIds: NonEmpty<string>;
    }
  | {
      ruleId: "P0-EXECUTION-001";
      status: "FAIL";
      reasonCode: "NO_ROUTE_FOUND";
      applicabilityReasonCode?: never;
      evidenceIds: NonEmpty<string>;
    }
  | {
      ruleId: "P0-EXECUTION-001";
      status: "UNKNOWN";
      reasonCode: "RULE_CLASSIFICATION_NOT_VERIFIED";
      applicabilityReasonCode?: never;
      evidenceIds: string[];
    };

type EconomicRuleResultView =
  | {
      ruleId: "P0-ECONOMIC-001";
      status: "PASS";
      reasonCode?: never;
      applicabilityReasonCode?: never;
      evidenceIds: NonEmpty<string>;
    }
  | {
      ruleId: "P0-ECONOMIC-001";
      status: "FAIL";
      reasonCode: "OUTPUT_BELOW_BOUNDARY";
      applicabilityReasonCode?: never;
      evidenceIds: NonEmpty<string>;
    }
  | {
      ruleId: "P0-ECONOMIC-001";
      status: "UNKNOWN";
      reasonCode: "SIMULATED_OUTPUT_UNAVAILABLE";
      applicabilityReasonCode?: never;
      evidenceIds: string[];
    }
  | {
      ruleId: "P0-ECONOMIC-001";
      status: "NOT_APPLICABLE";
      reasonCode?: never;
      applicabilityReasonCode: P0ApplicabilityReasonCode;
      evidenceIds: string[];
    };

type RuleResultView = EvidenceRuleResultView | ExecutionRuleResultView | EconomicRuleResultView;

interface IntentChangeView {
  field: "sender" | "recipient" | "recipientSource" | "amountIn" | "tokenPair" | "protocol" | "slippage" | "minimumReceived";
  before: IntentValueSnapshot;
  after: IntentValueSnapshot;
}

type TransactionAdjustmentChangeView = {
  field: "amountIn" | "tokenPair" | "protocol" | "slippage";
  before: IntentValueSnapshot;
  after: IntentValueSnapshot;
};

type AcceptanceBoundaryChangeView = {
  field: "minimumReceived";
  before: IntentValueSnapshot;
  after: IntentValueSnapshot;
};

interface VerifiedActionGateView {
  attestationEvidenceId: string;
  baselineRunId: string;
  verificationRunId: string;
  exactIntentDiff: TransactionAdjustmentChangeView[];
  originalBoundary: MinimumReceivedView;
  result: "VERIFIED";
}

type ProductActionSupportRef =
  | { kind: "EVIDENCE_REF"; runId: string; evidenceId: string }
  | { kind: "ERROR_REF"; runId: string }
  | { kind: "SCOPE_REF"; runId: string; subjectId: P0ScopeSubjectId }
  | { kind: "REPLAY_FALLBACK"; runId: string; fallbackId: string };

type NonEmpty<T> = [T, ...T[]];
type ActionGateEvidenceRef = Extract<ProductActionSupportRef, { kind: "EVIDENCE_REF" }>;
type TransactionActionSupportRefs = [ActionGateEvidenceRef, ...ProductActionSupportRef[]];
type RecoverySupportRef = Extract<ProductActionSupportRef, { kind: "EVIDENCE_REF" | "ERROR_REF" | "SCOPE_REF" }>;
type RecoverySupportRefs = NonEmpty<RecoverySupportRef>;
type ReplaySupportRef = Extract<ProductActionSupportRef, { kind: "REPLAY_FALLBACK" }>;
type ReplaySupportRefs = NonEmpty<ReplaySupportRef>;

interface ProductActionBaseView {
  actionId: string;
  copyKey: ProductCopyKey;
  actionReasonCode: P0ActionReasonCode;
  supportRefs: NonEmpty<ProductActionSupportRef>;
  addressesRuleId?: P0RuleId;
}

interface TransactionAdjustmentView extends ProductActionBaseView {
  category: "TRANSACTION_ADJUSTMENT";
  changes: NonEmpty<TransactionAdjustmentChangeView>;
  supportRefs: TransactionActionSupportRefs;
}

interface AcceptanceBoundaryChangeActionView extends ProductActionBaseView {
  category: "ACCEPTANCE_BOUNDARY_CHANGE";
  changes: [AcceptanceBoundaryChangeView];
}

type RecommendedActionView = TransactionAdjustmentView & {
  applicability: "RELEVANT";
  addressesRuleId: P0RuleId;
  actionReasonCode: "ALTERNATIVE_PATH_VERIFIED" | "OUTPUT_IMPROVEMENT_VERIFIED";
  gate: VerifiedActionGateView;
};

type IrrelevantActionView =
  | (TransactionAdjustmentView & {
      applicability: "IRRELEVANT";
      actionReasonCode: "CANNOT_CREATE_MISSING_ROUTE";
    })
  | (AcceptanceBoundaryChangeActionView & {
      applicability: "IRRELEVANT";
      actionReasonCode: "CHANGES_ACCEPTANCE_BOUNDARY_ONLY";
    });

interface ReplayFallbackDescriptorView {
  fallbackId: string;
  mode: "REPLAY" | "DEMO";
  label: string;
  copyKey: ProductCopyKey;
  source:
    | { kind: "RECORDED_RUN"; sourceRunId: string }
    | { kind: "DEMO_PRESET"; presetId: string }
    | { kind: "DEMO_FIXTURE"; fixtureId: string };
}

type RecoveryActionView =
  | {
      actionId: string;
      kind: "RETRY_CHECK" | "VIEW_MISSING_EVIDENCE";
      copyKey: ProductCopyKey;
      actionReasonCode: "RESTORES_CHECK_ONLY";
      supportRefs: RecoverySupportRefs;
    }
  | {
      actionId: string;
      kind: "USE_REPLAY";
      copyKey: ProductCopyKey;
      actionReasonCode: "RESTORES_CHECK_ONLY";
      supportRefs: ReplaySupportRefs;
      fallbackId: string;
    };

type MockPreviewMode = "MOCK_PREVIEW";

type RealScopeItemProvenanceView = {
  authority: "CORE" | "SUPPLEMENTARY";
  source: Exclude<EvidenceSource, "mock"> | "mixed";
  stage: EvidenceStage | "mixed";
  runId: string;
  fixtureId?: string;
  mode: ProductRunMode;
};

type MockScopeItemProvenanceView = {
  authority: "MOCK";
  source: "mock";
  stage: EvidenceStage;
  previewId: string;
  fixtureId?: string;
  mode: MockPreviewMode;
};

interface ScopeItemCommonFields {
  subjectId: P0ScopeSubjectId;
  copyKey: ProductCopyKey;
  evidenceIds: string[];
  replayFallbackIds: string[];
  summary: string;
}

type ScopeItemCommonView<P extends RealScopeItemProvenanceView | MockScopeItemProvenanceView> = ScopeItemCommonFields & {
  provenance: P;
};

type RuleScopeItemView =
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-EVIDENCE-001";
      status: "CHECKED";
      ruleStatus: "PASS";
      ruleReasonCode?: never;
      applicabilityReasonCode?: never;
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-EVIDENCE-001";
      status: "UNKNOWN";
      ruleStatus: "UNKNOWN";
      ruleReasonCode: P0EvidenceUnknownReasonCode;
      applicabilityReasonCode?: never;
      scopeReasonCode: P0ScopeUnknownReasonCode;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-EXECUTION-001";
      status: "CHECKED";
      ruleStatus: "PASS";
      ruleReasonCode?: never;
      applicabilityReasonCode?: never;
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-EXECUTION-001";
      status: "CHECKED";
      ruleStatus: "FAIL";
      ruleReasonCode: "NO_ROUTE_FOUND";
      applicabilityReasonCode?: never;
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-EXECUTION-001";
      status: "UNKNOWN";
      ruleStatus: "UNKNOWN";
      ruleReasonCode: P0ExecutionUnknownReasonCode;
      applicabilityReasonCode?: never;
      scopeReasonCode: P0ScopeUnknownReasonCode;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-ECONOMIC-001";
      status: "CHECKED";
      ruleStatus: "PASS";
      ruleReasonCode?: never;
      applicabilityReasonCode?: never;
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-ECONOMIC-001";
      status: "CHECKED";
      ruleStatus: "FAIL";
      ruleReasonCode: "OUTPUT_BELOW_BOUNDARY";
      applicabilityReasonCode?: never;
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-ECONOMIC-001";
      status: "UNKNOWN";
      ruleStatus: "UNKNOWN";
      ruleReasonCode: P0EconomicUnknownReasonCode;
      applicabilityReasonCode?: never;
      scopeReasonCode: P0ScopeUnknownReasonCode;
    })
  | EconomicNotApplicableScopeView;

type EconomicNotApplicableScopeView =
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-ECONOMIC-001";
      status: "NOT_CHECKED";
      ruleStatus: "NOT_APPLICABLE";
      ruleReasonCode?: never;
      applicabilityReasonCode: "BOUNDARY_NOT_PROVIDED";
      scopeReasonCode: "PRECONDITION_ABSENT";
      presentationLabel?: "NOT_APPLICABLE";
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: "P0-ECONOMIC-001";
      status: "NOT_CHECKED";
      ruleStatus: "NOT_APPLICABLE";
      ruleReasonCode?: never;
      applicabilityReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT";
      scopeReasonCode: "STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT";
      presentationLabel?: "NOT_APPLICABLE";
    });

type IndependentScopeItemView =
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: P0ScopeCheckId;
      status: "CHECKED";
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: P0ScopeCheckId;
      status: "UNKNOWN";
      scopeReasonCode: P0ScopeUnknownReasonCode;
    })
  | (ScopeItemCommonView<RealScopeItemProvenanceView> & {
      subjectId: P0ScopeCheckId;
      status: "NOT_CHECKED";
      scopeReasonCode: P0ScopeNotCheckedReasonCode;
    });

type ScopeItemView = RuleScopeItemView | IndependentScopeItemView;
type MockScopeItemView =
  | (ScopeItemCommonView<MockScopeItemProvenanceView> & {
      status: "CHECKED";
      scopeReasonCode?: never;
    })
  | (ScopeItemCommonView<MockScopeItemProvenanceView> & {
      status: "UNKNOWN";
      scopeReasonCode: P0ScopeUnknownReasonCode;
    })
  | (ScopeItemCommonView<MockScopeItemProvenanceView> & {
      status: "NOT_CHECKED";
      scopeReasonCode: P0ScopeNotCheckedReasonCode;
    });

interface ScopeCountsView {
  checked: number;
  failed: number; // derived presentation count; Rule FAIL remains canonical Scope checked
  unknown: number;
  notChecked: number;
}

interface ScopeDisclosureView {
  counts: ScopeCountsView;
  items: ScopeItemView[];
}

interface MockScopeDisclosureView {
  counts: ScopeCountsView;
  items: MockScopeItemView[];
}

type RunSideView =
  | {
      runId: string;
      status: "COMPLETED";
      systemStatus: "OK";
      verdict: Verdict;
      mode: ProductRunMode;
      provenance: RunProvenanceView;
      evidenceById: Record<string, RealEvidenceSummaryView>;
    }
  | {
      runId: string;
      status: "INTEGRATION_ERROR";
      systemStatus: "INTEGRATION_ERROR";
      verdict: "UNKNOWN";
      mode: ProductRunMode;
      provenance: RunProvenanceView;
      evidenceById: Record<string, RealEvidenceSummaryView>;
    };

interface EvidenceDiffView {
  addedEvidenceIds: string[];
  removedEvidenceIds: string[];
  changedEvidenceIds: string[];
}

interface RunDiffView {
  previous: RunSideView;
  next: RunSideView;
  relationship: "RERUN" | "MODIFIED_INTENT" | "VERIFIED_ACTION_APPLIED";
  previousIntent: IntentSummaryView;
  newIntent: IntentSummaryView;
  changedIntentFields: IntentChangeView[];
  changedRuleIds: P0RuleId[];
  evidenceDiff: EvidenceDiffView;
  appliedActionId?: string;
  acceptanceBoundaryChanged: boolean;
  comparableOutput?: { previous: string; next: string };
}

type RecoveryCta =
  | { kind: "RETRY_CHECK"; recoveryActionId: string }
  | { kind: "VIEW_MISSING_EVIDENCE"; recoveryActionId: string }
  | { kind: "USE_REPLAY"; recoveryActionId: string };
type DetailsCta = { kind: "VIEW_DETAILS"; target: "INTEGRATION_ERROR_DETAILS" | "EVIDENCE_DETAILS" | "MOCK_PREVIEW_DETAILS" };
type ReviewBlockingEvidenceCta = { kind: "REVIEW_BLOCKING_EVIDENCE"; target: "SCOPE_AND_EVIDENCE" };
type ReviewCheckedScopeCta = { kind: "REVIEW_CHECKED_SCOPE"; target: "SCOPE_AND_EVIDENCE" };
type ReturnToTransactionCta = { kind: "RETURN_TO_TRANSACTION"; origin: OriginContextView };
type ApplyTransactionActionCta = { kind: "APPLY_TRANSACTION_ACTION"; actionId: string };
type NavigationCta = DetailsCta | ReviewBlockingEvidenceCta | ReviewCheckedScopeCta | ReturnToTransactionCta;
type ProductCta = RecoveryCta | NavigationCta | ApplyTransactionActionCta;
type ProceedPrimaryCta = ReturnToTransactionCta | ReviewCheckedScopeCta;
type UnknownPrimaryCta = ReviewCheckedScopeCta | Extract<RecoveryCta, { kind: "VIEW_MISSING_EVIDENCE" }>;
type UnknownSecondaryCta = ReviewCheckedScopeCta | RecoveryCta;
type IntegrationErrorPrimaryCta = Extract<RecoveryCta, { kind: "RETRY_CHECK" }> | DetailsCta;
type IntegrationErrorSecondaryCta = RecoveryCta | DetailsCta;

interface RealProductEvidenceView {
  evidenceById: Record<string, RealEvidenceSummaryView>;
  coreEvidenceIds: string[];
}

interface CompletedProductBaseView extends RealProductEvidenceView {
  kind: "COMPLETED_RESULT";
  status: "COMPLETED";
  systemStatus: "OK";
  mode: ProductRunMode;
  runId: string;
  provenance: RunProvenanceView;
  intent: IntentSummaryView;
  rules: RuleResultView[];
  scope: ScopeDisclosureView;
  recoveryActions: RecoveryActionView[];
  replayFallbacks: Record<string, ReplayFallbackDescriptorView>;
  comparison?: RunDiffView;
}

type CompletedProductView =
  | (CompletedProductBaseView & {
      verdict: "PROCEED";
      recommendedActions: [];
      irrelevantActions: IrrelevantActionView[];
      primaryCta: ProceedPrimaryCta;
      secondaryCta?: ReviewCheckedScopeCta;
    })
  | (CompletedProductBaseView & {
      verdict: "ADJUST";
      recommendedActions: [RecommendedActionView, ...RecommendedActionView[]];
      irrelevantActions: IrrelevantActionView[];
      primaryActionId: string;
      primaryCta: ApplyTransactionActionCta;
      secondaryCta?: ReviewCheckedScopeCta;
    })
  | (CompletedProductBaseView & {
      verdict: "STOP";
      recommendedActions: RecommendedActionView[];
      irrelevantActions: IrrelevantActionView[];
      primaryCta: ReviewBlockingEvidenceCta;
      secondaryCta?: ReviewCheckedScopeCta;
    })
  | (CompletedProductBaseView & {
      verdict: "UNKNOWN";
      recommendedActions: [];
      irrelevantActions: [];
      primaryCta: UnknownPrimaryCta;
      secondaryCta?: UnknownSecondaryCta;
    });

interface IntegrationErrorProductView extends RealProductEvidenceView {
  kind: "INTEGRATION_ERROR_RESULT";
  status: "INTEGRATION_ERROR";
  systemStatus: "INTEGRATION_ERROR";
  mode: ProductRunMode;
  runId: string;
  provenance: RunProvenanceView;
  intent: IntentSummaryView;
  verdict: "UNKNOWN";
  error: {
    code: IntegrationErrorCode;
    stage: IntegrationErrorStage;
    message: string;
    retryable: boolean;
  };
  recoveryActions: RecoveryActionView[];
  recommendedActions: [];
  irrelevantActions: [];
  replayFallbacks: Record<string, ReplayFallbackDescriptorView>;
  primaryCta: IntegrationErrorPrimaryCta;
  secondaryCta?: IntegrationErrorSecondaryCta;
  comparison?: RunDiffView;
}

interface PendingProductView {
  kind: "PENDING_RESULT";
  status: "PENDING";
  intent?: IntentSummaryView;
  phase: "VALIDATING_INTENT" | "FETCHING_EVIDENCE" | "EVALUATING_RULES" | "FINALIZING_ACTION_GATES";
}

interface MockRulePreviewView {
  kind: "MOCK_RULE_PREVIEW";
  previewId: string;
  copyKey: ProductCopyKey;
  previewVerdict?: Verdict;
  rules: RuleResultView[];
  scope: MockScopeDisclosureView;
  evidenceById: Record<string, MockEvidenceSummaryView>;
  replayFallbacks: Record<string, ReplayFallbackDescriptorView>;
  recommendedActions: [];
  irrelevantActions: [];
  primaryCta: { kind: "VIEW_DETAILS"; target: "MOCK_PREVIEW_DETAILS" };
}

type ProductDeliveryView =
  | PendingProductView
  | CompletedProductView
  | IntegrationErrorProductView
  | MockRulePreviewView;
```

Product adapter invariants for this proposal:

- `RuleResultView` must be validated against the exhaustive Rule-specific table before mapping to Product/UI. Every Rule `PASS` and `FAIL` branch carries `evidenceIds: NonEmpty<string>`; `UNKNOWN` and `NOT_APPLICABLE` intentionally retain `string[]` because PR #3 permits wholly absent or inapplicable supporting Evidence.
- `RunSideView` is a legal state union: `COMPLETED` requires `systemStatus = OK` and any centralized `Verdict`, while `INTEGRATION_ERROR` requires `systemStatus = INTEGRATION_ERROR` and `verdict = UNKNOWN`. `RunDiffView` may compare any two explicitly related valid sides, including Completed/Error in either direction; it never accepts an in-flight or Mock side.
- Scope `status` is only `CHECKED`, `UNKNOWN`, or `NOT_CHECKED`; `presentationLabel = NOT_APPLICABLE` is not a fourth canonical state. Checked Rule `FAIL` items carry their closed Rule reason (`NO_ROUTE_FOUND` or `OUTPUT_BELOW_BOUNDARY`) and Product copy is selected from that code, never parsed from `summary`. Economic `NOT_APPLICABLE` Scope items accept only the two discriminated applicability/reason pairs declared above; no other Rule or Scope reason may be combined with them.
- `coreEvidenceIds` must never include `source = mock` or unresolved/unknown critical Evidence. A completed `PROCEED`, `ADJUST`, or `STOP` and every public transaction Action must resolve only to eligible non-mock Evidence.
- Every `evidenceIds` value used to support a Rule `PASS`/`FAIL`, the completed Verdict, or a public transaction Action must resolve to `coreEvidenceIds`; supplementary or mock Evidence may be displayed as context but can never be accepted as authoritative support.
- The current reviewed PR #4 contract supplies normalized `recipient`, `recipientSource`, and `protocol`; Product/UI consumes those fields and does not infer them from display values. Normalized `IntentSummaryView.slippage` is optional until the Contract carries it. When present, it is an explicit present/absent snapshot supplied by the adapter; Product/UI must not infer it from display copy, Quote values, Route Evidence, or Action text. A public `slippage` transaction Action requires present baseline and child snapshots plus an exact attested diff; otherwise the candidate remains internal. Every `IntentChangeView` and Action change uses required `before` and `after` snapshots, and a transaction Action diff must resolve to fields present in both normalized baseline and child Intents, exactly equal the attested diff, and must not target identity/provenance or `minimumReceived`.
- Every public Action has a non-empty support-ref tuple. A transaction adjustment's first support ref must be the baseline-Run `EVIDENCE_REF` for its local `ActionGateAttestation`; the adapter must reject generic Scope, Error, Replay, supplementary, or Mock-only support. The attestation ID and baseline Run ID must match the Action's `gate` and resolve in `evidenceById`.
- `recommendedActions` require `gate.result = VERIFIED`, a local attestation EvidenceRef, a non-empty category-specific Intent diff, and `gate.exactIntentDiff` equal to the public Action `changes` field-for-field; the original Boundary must remain unchanged and the child Receipt must be terminal. Cross-Run locators remain nested in the attestation.
- `recoveryActions` use non-empty, kind-specific support refs: `RETRY_CHECK` and `VIEW_MISSING_EVIDENCE` may use only applicable `ErrorRef`, `ScopeRef`, or `EvidenceRef`; `USE_REPLAY` uses only same-Run `REPLAY_FALLBACK` refs. Its `fallbackId` must match the selected descriptor, whose label is non-empty and whose recorded source Run differs from the current Run. Any unresolved, cross-Run, mismatched, or inapplicable reference keeps the candidate internal.
- Public transaction Action changes are limited to `amountIn`, `tokenPair`, `protocol`, and `slippage`; `minimumReceived` is only an `ACCEPTANCE_BOUNDARY_CHANGE`, and `sender`, `recipient`, and `recipientSource` are never Action targets.
- `primaryCta` is the only source of CTA routing and is state-specific: `ADJUST` has exactly one `primaryActionId` that matches exactly one unique `recommendedActions[].actionId`; `STOP` uses `REVIEW_BLOCKING_EVIDENCE`; `PROCEED` uses `RETURN_TO_TRANSACTION` only with normalized `origin`, otherwise `REVIEW_CHECKED_SCOPE`; `UNKNOWN` never applies a transaction Action and uses `VIEW_MISSING_EVIDENCE` only when `scope.counts.unknown > 0` and its destination is non-empty; Integration Error uses `RETRY_CHECK` only when `error.retryable`, otherwise implementable `VIEW_DETAILS`. Recovery/navigation CTAs are not Action list entries.
- `evidenceById` is the adapter's indexed lookup surface; components must not join flat Evidence arrays during rendering. `ScopeItemView.replayFallbackIds` resolve through the same Run-level `replayFallbacks` map, so a row never selects an arbitrary Evidence label. Each `RunSideView.evidenceById` is the indexed lookup for that specific Previous or New Run; the top-level Product view may expose the current side's same index, but the adapter must not create a second independent Evidence store. `RunDiffView.evidenceDiff` resolves added IDs in `next.evidenceById`, removed IDs in `previous.evidenceById`, and changed IDs in both. Added, removed, and changed sets must be unique and disjoint, and Mock-only Evidence cannot be authoritative comparison support.
- `MockRulePreviewView.kind = "MOCK_RULE_PREVIEW"` is the authoritative Mock discriminator. Its Evidence entries use `authority = "MOCK"`, `mode = "MOCK_PREVIEW"`, and `previewId`; they do not carry a real `runId` or `ProductRunMode`, and the preview is never a finalized user Run or source of a user Verdict. `MockScopeItemView` is also discriminated: `CHECKED` has no Scope reason, `UNKNOWN` requires an unknown reason, and `NOT_CHECKED` requires a not-checked reason; the adapter rejects every other pairing.
- Completed and Integration Error projections may use only real Evidence provenance (`authority = CORE | SUPPLEMENTARY`); Mock Evidence is not an authoritative Scope, Rule, Verdict, or Action support source.
- English normative copy is represented by `copyKey` values. Every emitted key must resolve through a reviewed `en` and `zh-CN` catalog before implementation; a missing locale mapping is an adapter/catalog error, not a reason to hardcode or silently reinterpret copy.

Contract and API owners must confirm field names, versioning, serialization, error preservation, Evidence reference granularity, and compatibility behavior before implementation treats this proposal as stable. Product/UI must still consume the centralized result rather than reproduce Rule or Verdict logic in the adapter.

## 13. Stakeholder handoff

| Stakeholder | Primary review responsibility |
| --- | --- |
| Rei (`rainypilgrimage-beep`) | Rule-to-product semantic accuracy, canonical Scope categories and reason vocabulary, Action visibility boundaries, unsupported inference |
| Jie (`jzhao0`) | Real Fixture accuracy, Moss Evidence, provenance, Live／Replay／Mock claims, normalized Intent and Action Gate feasibility |
| Clare (`brightheartma`) | Product View Model unions, Contract/API mapping, Integration Error payload, Recovery Action and ReplayRef adapter mapping |
| Antony (`antony819`) | CTA routing, frontend implementability, Scope provenance, loading/empty states, i18n, Previous/New and View Model ergonomics |

All stakeholders may review in parallel. Semantic or Evidence-boundary findings from Rei and Jie take precedence over frontend refinements, while Clare's Contract/API compatibility findings govern adapter assumptions. Antony may review at any time; no reviewer is prohibited from parallel review.

The document deliberately leaves the following gates open: real `NO_ROUTE` classification, Action Recommendation and causal rerun proof, simulated-output economic evaluation, Warning classification, critical asset-change classification, external Evidence policy, structured Rule/Action Contract implementation, and final API mapping. Until the relevant gate passes, Product/UI must disclose `UNKNOWN`, omit speculative public Actions, or show an explicitly labeled Mock preview.
