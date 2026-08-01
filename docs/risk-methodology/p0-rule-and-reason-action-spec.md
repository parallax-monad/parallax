# Parallax P0 Rule and Reason-to-Action Specification v0.1

> Status: Normative P0 rule-and-contract semantic standard; implementation and runtime activation pending
> Product source of truth: `docs/product/prd_cn.md` (PRD v0.4; introduced and merged via PR #2)
> Runtime impact: None. Merging this document does not activate any rule or Verdict behavior defined by this specification. Each user-visible mapping may be activated only after its corresponding Shared Contract implementation, automated policy tests, and required Evidence, Classification, and Action Gates are complete.

## 1. Purpose

This specification defines stable rule and contract semantics shared by the risk engine, Shared Contract, API, frontend, and tests. It builds on the existing evidence, normalization, simulation-coverage, error-isolation, and baseline-verdict concepts.

It does not define a complete risk taxonomy. Version 0.1 freezes the first P0 vertical slice: three Rule Contracts, centralized Verdict aggregation, Scope Disclosure, Evidence reference integrity, Reason-to-Action boundaries, and the public Run envelope. Implementation and runtime activation remain separate follow-up work.

## 2. Scope

### Included

- Separate individual Rule Results from the global user Verdict.
- Define machine-readable Rule Statuses, Rule IDs, Reason Codes, and legal combinations.
- Define how Rule Status maps to `checked`, `not_checked`, and `unknown` Scope Disclosure.
- Separate transaction adjustments, acceptance-boundary changes, and system-recovery actions.
- Define `ActionEvaluation` as the canonical source of public recommended and irrelevant actions.
- Define a conservative total function for centralized Verdict aggregation.
- Define `P0-EVIDENCE-001 / EVIDENCE_COMPLETENESS`.
- Define `P0-EXECUTION-001 / ROUTE_AVAILABILITY`.
- Define `P0-ECONOMIC-001 / OUTPUT_MEETS_BOUNDARY`.
- Define the semantic requirements for Completed and Integration Error public Run envelopes.
- Provide initial vectors that must become Contract and Rule tests before runtime activation.

### Excluded

- Runtime changes or activation.
- Complete Live, Replay, and Demo infrastructure.
- A complete warning and cause taxonomy.
- Transaction-parameter recommendations that lack real Evidence.
- Final user-facing copy and information architecture.
- Exact package placement, Zod implementation, serializer code, and internal technically equivalent field encodings.

## 3. v0.1 Normative Contract

### 3.1 Rule Status Describes Whether a Positive Requirement Holds

Rule names state the positive requirement being checked. Reason Codes record why that requirement failed or could not be evaluated. This avoids inverted semantics such as treating `NO_ROUTE_FOUND` itself as the name of a Rule that returns `FAIL`.

```ts
type RuleStatus =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

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

type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";
```

Semantics:

- `PASS`: Evidence is sufficient and the Rule requirement is satisfied. This does not mean the transaction is safe overall.
- `FAIL`: Evidence is sufficient and the Rule requirement is violated.
- `UNKNOWN`: The Rule applies, but the available Evidence is insufficient or unreliable.
- `NOT_APPLICABLE`: The Rule precondition does not exist, or the current execution path does not enter the relevant stage. A structured `applicabilityReasonCode` records which condition applies without affecting Verdict priority.

Legal Status sets are Rule-specific:

| Rule | Legal Statuses |
|---|---|
| `P0-EVIDENCE-001` | `PASS`, `UNKNOWN` |
| `P0-EXECUTION-001` | `PASS`, `FAIL`, `UNKNOWN` |
| `P0-ECONOMIC-001` | `PASS`, `FAIL`, `UNKNOWN`, `NOT_APPLICABLE` |

The following Rule outcome table is exhaustive for P0 v0.1:

| Rule | Status | Required Reason |
|---|---|---|
| `P0-EVIDENCE-001` | `PASS` | no Reason Code or Applicability Reason |
| `P0-EVIDENCE-001` | `UNKNOWN` | `SIMULATION_COVERAGE_MISSING`, `SIMULATION_HALTED`, `CRITICAL_EVIDENCE_MISSING`, `UNCLASSIFIED_WARNING`, `UNEXPLAINED_ASSET_CHANGE`, `EVIDENCE_SOURCE_UNKNOWN`, `EVIDENCE_NOT_REPRODUCIBLE`, or `OUTPUT_SOURCE_CONFLICT` |
| `P0-EXECUTION-001` | `PASS` | no Reason Code or Applicability Reason |
| `P0-EXECUTION-001` | `FAIL` | `NO_ROUTE_FOUND` |
| `P0-EXECUTION-001` | `UNKNOWN` | `RULE_CLASSIFICATION_NOT_VERIFIED` |
| `P0-ECONOMIC-001` | `PASS` | no Reason Code or Applicability Reason |
| `P0-ECONOMIC-001` | `FAIL` | `OUTPUT_BELOW_BOUNDARY` |
| `P0-ECONOMIC-001` | `UNKNOWN` | `SIMULATED_OUTPUT_UNAVAILABLE` |
| `P0-ECONOMIC-001` | `NOT_APPLICABLE` | `BOUNDARY_NOT_PROVIDED` or `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT` as the Applicability Reason |

`PASS` has neither a Rule Reason Code nor an Applicability Reason. `FAIL` and `UNKNOWN` require the Rule Reason Code declared above. `NOT_APPLICABLE` has no Rule Reason Code and requires the declared Applicability Reason.

The Shared Contract must reject every Rule ID, Status, Reason Code, and Applicability Reason combination absent from this table. A generic union of every P0 Reason Code is not sufficient. For example, `P0-EXECUTION-001 / FAIL / OUTPUT_BELOW_BOUNDARY` and `P0-ECONOMIC-001 / UNKNOWN / NO_ROUTE_FOUND` are invalid.

### 3.2 Reason Codes and Scope Disclosure Drive Aggregation and Tests

Free-form explanations are not aggregation inputs. Aggregation, Contract tests, and frontend mapping use stable `ruleId + status + reasonCode` tuples for `FAIL` and `UNKNOWN`. `NOT_APPLICABLE` uses a structured `applicabilityReasonCode`.

```text
(P0-EXECUTION-001, FAIL, NO_ROUTE_FOUND)
  -> VerdictPolicy: STOP

(P0-EVIDENCE-001, UNKNOWN, SIMULATION_COVERAGE_MISSING)
  -> VerdictPolicy: UNKNOWN
```

Natural-language copy may change or be translated, but it must not change machine semantics.

Scope Disclosure answers whether a specific declared check completed; it does not restate whether that check passed:

| Rule or check result | Scope Status |
|---|---|
| A Rule returns `PASS` or `FAIL` | `checked` |
| A Rule returns `UNKNOWN` | `unknown` |
| A Rule returns `NOT_APPLICABLE` | `not_checked` |
| An Integration Error interrupts a check that the current path required | `unknown`, without fabricating a Rule Result |
| A trusted terminal result means a later stage must not be entered | `not_checked` |
| An item is explicitly outside P0 | `not_checked` |

Normative Scope constraints:

- Every Scope Item binds to exactly one stable registered subject: either a P0 Rule ID or an independently declared Check ID. Labels and notes are replaceable display text and are not aggregation inputs.
- A Rule-bound Scope Item is mechanically consistent with its Rule Result: `PASS` or `FAIL` maps to `checked`, `UNKNOWN` maps to `unknown`, and `NOT_APPLICABLE` maps to `not_checked`. It must not carry an independently authored status or reason that contradicts the Rule Result.
- When an Integration Error interrupts a required Rule before a trustworthy Rule Result exists, the Rule Result remains absent and the Rule-bound Scope Item is `unknown / REQUIRED_CHECK_INTERRUPTED`.
- Independent checks use a closed, Status-valid Scope reason vocabulary. P0 `unknown` reasons are `REQUIRED_CHECK_INTERRUPTED`, `REQUIRED_EVIDENCE_UNAVAILABLE`, and `CLASSIFICATION_INCOMPLETE`. P0 `not_checked` reasons are `PRECONDITION_ABSENT`, `STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT`, and `OUTSIDE_P0_SCOPE`.
- A Scope subject appears at most once in a Run.
- Any `unknown` Scope Item blocks `PROCEED`. There is no ad hoc non-blocking `unknown`.
- Items that do not need to block `PROCEED` because they are outside P0, have no precondition, or follow a trusted terminal result use `not_checked`.
- Evidence acquisition and Evidence interpretation use distinct registered Check IDs. For example, a returned Moss Warning may be collected while Warning Classification remains `unknown / CLASSIFICATION_INCOMPLETE`.
- Completed `checked` items remain visible when another check becomes `unknown` or an Integration Error occurs.

The Shared Contract must use one canonical Scope collection with per-item Status rather than independently maintained `checked`, `notChecked`, and `unknowns` arrays. Consumers may derive those views, but they must not create a second source of Scope truth.

### 3.3 ActionEvaluation Is the Source of Public Actions

System-recovery actions do not change the transaction and must not be treated as transaction adjustments. When cause-to-action Evidence is missing, the system must not recommend changing transaction parameters merely to avoid returning an empty action list.

```ts
type NextAction =
  | {
      kind: "TRANSACTION_ADJUSTMENT";
      field: "amountIn" | "tokenPair" | "protocol" | "slippage";
    }
  | {
      kind: "ACCEPTANCE_BOUNDARY_CHANGE";
      field: "minimumReceived";
    }
  | {
      kind: "SYSTEM_RECOVERY";
      action: "RETRY_CHECK" | "VIEW_MISSING_EVIDENCE" | "USE_REPLAY";
    };
```

This union freezes the P0 Action taxonomy, not the complete public wire encoding. The Shared Contract representation of an `ActionEvaluation` must preserve:

- a stable Action identity that is unique within the Run and remains stable in the public projection;
- the `NextAction` category;
- a concrete proposed Intent change when a transaction adjustment is publicly recommendable;
- `relevance`, `recommendable`, and a stable `P0ActionReasonCode`; and
- Action support references.

Action support is a discriminated reference to canonical machine state:

```text
ActionSupportRef = EvidenceRef | ErrorRef | ScopeRef
```

An `EvidenceRef` resolves to canonical Evidence in the same Run. An `ErrorRef` resolves to the Run's structured Integration Error. A `ScopeRef` resolves to one canonical Scope Item. The Shared Contract freezes the exact field-discriminated encoding without changing these reference semantics.

`ActionEvaluation`, not an independently authored Recommendation, is the canonical source of public actions:

- Only a verified `RELEVANT` Action with `recommendable = true` may enter `recommendedActions`.
- Only a verified `IRRELEVANT` Action with `recommendable = false` may enter `irrelevantActions`.
- `UNKNOWN`, relevant-but-not-yet-recommendable, and otherwise unverified candidates remain internal to Risk and Aggregation. They enter neither public list.
- `recommendable = true` is invalid with `IRRELEVANT` or `UNKNOWN` relevance.
- An empty public transaction-adjustment list is valid.
- Every public Action has a unique stable Action identity and non-empty `ActionSupportRef` values that resolve within the same Run.
- A public transaction adjustment requires at least one supporting `EvidenceRef`, a concrete proposed Intent change, and the applicable Action Recommendation Gate result.
- A public system-recovery Action may instead be supported by the structured Integration Error or Scope Item that makes the recovery applicable. It must not contain a proposed transaction change.

A `TRANSACTION_ADJUSTMENT` changes transaction conditions. `amountIn`, `tokenPair`, `protocol`, and `slippage` are the P0 transaction-adjustment targets. `route` is execution Evidence produced by the check, not a P0 user-editable Action target.

PRD v0.4 uses `Route / Protocol` as one product-level adjustable category. P0 v0.1 maps that category to the user-editable `protocol` Intent target. A concrete Route returned by Moss remains execution Evidence. A future independently editable Route selector requires a versioned Contract extension rather than being inferred from Route Evidence.

A public recommended transaction adjustment must identify the concrete proposed Intent change, not only the field category. For example, it identifies the target Protocol, the complete target Token Pair, or the proposed Amount. The Shared Contract freezes the field-discriminated representation. The Action Recommendation Gate must support that specific change with a rerun or equivalent Evidence.

An `ACCEPTANCE_BOUNDARY_CHANGE` changes only the user's evaluation threshold; it does not improve the transaction outcome. In P0, it has `recommendable = false` and must not manufacture `ADJUST` or `PROCEED` by lowering Minimum Received. If the user independently changes Minimum Received, that is a new Intent and Run.

A `SYSTEM_RECOVERY` Action only helps complete or restore the check:

- `RETRY_CHECK` is public only when retry is applicable, including consistency with `error.retryable` for Integration Errors.
- `VIEW_MISSING_EVIDENCE` is public only when the Run identifies missing or incomplete Evidence.
- `USE_REPLAY` is public only when a Replay or Demo fallback actually exists, is explicitly labeled, and is not presented as Evidence from the current Live Run.

Rule Reason Codes and Action Reason Codes answer different questions. `P0ReasonCode` explains why a Rule failed or could not be evaluated; `P0ActionReasonCode` explains why an Action is relevant, irrelevant, unverified, or limited to system recovery. Consumers must not use Action Reason Codes as Verdict aggregation inputs.

Examples:

| Action basis | `actionReasonCode` |
|---|---|
| A rerun verifies an alternative execution path | `ALTERNATIVE_PATH_VERIFIED` |
| A rerun verifies improved output against the unchanged boundary | `OUTPUT_IMPROVEMENT_VERIFIED` |
| The action cannot create a missing Route | `CANNOT_CREATE_MISSING_ROUTE` |
| The action changes only the user's acceptance threshold | `CHANGES_ACCEPTANCE_BOUNDARY_ONLY` |
| The causal effect has not been verified | `EFFECT_NOT_VERIFIED` |
| The action restores or completes the check only | `RESTORES_CHECK_ONLY` |

### 3.4 Economic Boundary Context Is Not a Second Rule Result

The top-level Economic Boundary records only the user's or transaction's input context and provenance:

- `original_swap`: explicitly provided by the original transaction or DEX intent;
- `user_declared`: explicitly entered by the user;
- `demo_preset`: allowed only in an explicitly labeled Demo or Replay flow;
- `unavailable`: no usable boundary exists.

The top-level Boundary does not carry a second `PASS / FAIL / UNKNOWN / NOT_APPLICABLE` status. `P0-ECONOMIC-001` is the only source of the Economic Rule Result.

Boundary invariants:

- An unavailable Boundary produces `P0-ECONOMIC-001 = NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED`.
- An available Boundary may still produce `NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT` after a trusted earlier terminal result such as `NO_ROUTE_FOUND`.
- An available Boundary cannot produce `NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED`.
- When Simulation is required, an available Boundary with missing or unreliable simulated output produces `UNKNOWN`.
- `demo_preset` is invalid in an unlabeled Live Run.
- Boundary context and source remain present in Completed and Integration Error Run envelopes.

### 3.5 Evidence Identity, References, and Provenance

The public Run contains a canonical Evidence collection. Each Evidence record has a unique stable key and preserves the provenance required to review its use, including the applicable source, stage, reproducibility, block or time context, Runtime Version or Revision, and Live, Replay, or Fixture scope. Exact field names are frozen in the Shared Contract.

`EvidenceRef` identifies an Evidence record in that canonical collection. Rule Results and public Actions must not duplicate or independently rewrite Evidence provenance. The Shared Contract enforces that every Evidence reference resolves within the same Run.

Evidence sources include `moss`, `rpc`, `quote`, `external`, `derived`, `mock`, and `unknown`. Provenance requirements are source-aware:

- Mock Evidence must not support a core `PASS`, `FAIL`, public transaction Action, or user-visible `PROCEED`, `ADJUST`, or `STOP`. It may validate code paths and Contract rejection or fallback behavior.
- Replay preserves the original Evidence source. Replay is a Run mode or explicit execution marker, not a replacement Evidence source.
- Live consumers must not present recorded Fixture Evidence as Evidence from the user's current Run.
- Derived Evidence identifies its input Evidence and derivation or formula.
- Unknown-source or non-reproducible critical Evidence cannot support `PASS` or `FAIL`.
- External Evidence is denied as an independent source of core P0 `PASS` or `FAIL` unless the consuming Rule Contract explicitly allows that source class and defines identity, freshness, provenance, and reproducibility requirements.

Raw Evidence status such as confirmed, warning, failed, unknown, or not applicable is input to stage-aware Rules. It is not a direct Verdict source.

### 3.6 Separate Rule Results, Policy, and the Public Run Envelope

An individual Rule reports only its local finding. It does not generate the final Verdict, declare a free-form `verdictEffect`, or carry a free-form `nonInferenceCodes` list.

```ts
type RuleResultBase = {
  ruleId: P0RuleId;
  evidenceRefs: EvidenceRef[];
};

type RuleResult = RuleResultBase &
  (
    | {
        status: "PASS";
        reasonCode?: never;
        applicabilityReasonCode?: never;
      }
    | {
        status: "NOT_APPLICABLE";
        reasonCode?: never;
        applicabilityReasonCode: P0ApplicabilityReasonCode;
      }
    | {
        status: "FAIL" | "UNKNOWN";
        reasonCode: P0ReasonCode;
        applicabilityReasonCode?: never;
      }
  );
```

Rule Result constraints:

- A `ruleId` appears at most once in a Run.
- `PASS` and `FAIL` require supporting Evidence references.
- `UNKNOWN` requires a stable Reason Code; its Evidence references may be empty when the required Evidence is wholly absent.
- `NOT_APPLICABLE` requires an Applicability Reason and does not accept a Rule Reason Code.
- Rule-specific Status and Reason combinations are enforced at the Shared Contract boundary.
- The absence of an unfinished Rule Result during Integration Error must be represented by Scope `unknown`, not by a fabricated Rule Result.

The public Run envelope preserves a single set of audit fields across Completed and Integration Error branches:

- `runId` and optional `parentRunId`;
- normalized Intent, including Protocol, Slippage when supported, and the P0 transaction conditions used by Adjust and Re-run;
- one authoritative Live, Replay, or explicit Demo execution mode;
- `status`, `systemStatus`, and the single canonical public `verdict`;
- replaceable `summary` display text;
- Economic Boundary context;
- optional Route Evidence when it was actually obtained;
- canonical Evidence, Scope Disclosure, and Rule Results;
- public `recommendedActions` and `irrelevantActions`;
- optional `diff`;
- `createdAt`, Rule Version, and the applicable Moss Runtime Version or Revision.

The later Shared Contract implementation freezes the public field names and technically equivalent wire encodings, but it must preserve these semantics.

The Run envelope begins only after the untrusted request has passed API validation and a normalized Intent exists. Invalid user input or failed Intent normalization is an API validation result, not an `integration_error` Run. An Integration Error at the `normalization` stage refers to downstream integration or Evidence normalization after the Run has begun.

Completed branch:

```text
status = completed
systemStatus = OK
verdict = PROCEED | ADJUST | STOP | UNKNOWN
error = absent
```

Integration Error branch:

```text
status = integration_error
systemStatus = INTEGRATION_ERROR
verdict = UNKNOWN
error = required
recommendedActions = applicable SYSTEM_RECOVERY actions only
irrelevantActions = []
```

Cross-branch invariants:

- `status = completed` if and only if `systemStatus = OK` and `error` is absent.
- `status = integration_error` if and only if `systemStatus = INTEGRATION_ERROR` and `error` is present; this branch requires `verdict = UNKNOWN`.
- `verdict` is the only canonical public Verdict. Rule Results, Scope Items, display copy, and legacy projections must not create a second Verdict source.
- A Completed Run follows the central Action policy. It may contain applicable `SYSTEM_RECOVERY` Actions when the system completed normally but the Verdict is `UNKNOWN` because required Evidence or classification is incomplete.
- An Integration Error Run exposes only applicable `SYSTEM_RECOVERY` Actions in `recommendedActions` and requires `irrelevantActions = []`.
- Route Evidence obtained before a later failure remains available; no placeholder Route is manufactured when Route Evidence does not exist.
- Economic Boundary context remains available even when its Rule evaluation was not completed.
- `parentRunId` and `diff` remain available for a failed Re-run because they describe the Intent change, not a successful new Verdict.
- `diff.previousRunId` is consistent with `parentRunId`, and Diff fields include the user-editable Protocol and transaction conditions.
- Flat free-form Decision `reasons` and independently authored `recommendations` do not become parallel machine-semantic sources.

### 3.7 Map Internal Integration Status to the Public Envelope

The internal integration layer distinguishes:

```text
OK | INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT
```

The public contract exposes:

```text
OK | INTEGRATION_ERROR
```

Mapping:

```text
OK -> OK
INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT -> INTEGRATION_ERROR
```

The specific collapsed cause remains available through a structured error code. `error.code`, `error.stage`, and `error.retryable` are stable machine fields. `error.code` and `error.stage` must use closed, versioned Shared Contract enumerations rather than free-form strings. The Shared Contract implementation freezes the exact enum members and technically equivalent encoding. `error.message` is replaceable display text and must not drive Verdict aggregation.

| Internal result | Public mapping |
|---|---|
| `OK` | `status = completed`, `systemStatus = OK`, no `error` |
| Moss or RPC unavailable | `status = integration_error`, `systemStatus = INTEGRATION_ERROR`, subsystem-specific unavailable `error.code` |
| `TIMEOUT` | `status = integration_error`, `systemStatus = INTEGRATION_ERROR`, `error.code = TIMEOUT` |
| Invalid response or internal integration failure | `status = integration_error`, `systemStatus = INTEGRATION_ERROR`, the applicable structured `error.code` |

The Integration Error branch preserves trustworthy partial results:

- Rule Results, Scope Items, Route Evidence, and other Evidence completed before the failure remain present.
- No protocol-risk or transaction-risk Rule `FAIL` is generated from the Integration Error itself.
- Checks interrupted by the error are Scope `unknown`.
- No transaction adjustment or acceptance-boundary change is public.
- Only applicable `SYSTEM_RECOVERY` Actions may enter `recommendedActions`.
- Public `verdict = UNKNOWN` means that the system did not complete a trustworthy transaction check; it is not a transaction-risk or protocol-risk conclusion and does not create a separate compatibility Verdict.

User-facing title, copy, CTA, and page priority remain outside this Rule Contract and belong in the Product/UI specification.

### 3.8 Evidence Status, Replay, and Mock Do Not Independently Determine Verdict

Raw Evidence follows the stage-aware path:

```text
Raw Evidence
-> determine whether the current path requires it
-> produce a Rule Result and Scope Status
-> aggregate the global Verdict centrally
```

- Evidence from a later stage that was never entered because of a trusted earlier terminal result maps to Rule `NOT_APPLICABLE` and Scope `not_checked`, not `UNKNOWN`.
- Evidence required by the current path that is missing, incomplete, unreliable, or of unverified origin produces a blocking Rule or Scope `unknown`.
- An unclassified Moss Warning produces Rule and Scope `unknown`; consumers must not infer `ADJUST` or `STOP` from Warning text.
- A Warning never selects a Rule ID, Status, or Reason Code by itself. A verified Warning may be supporting Evidence only after independent normalization maps the underlying condition to one of the legal P0 v0.1 Rule tuples. P0 has no standalone Warning `FAIL`.
- Evidence explicitly classified as disclosure-only, and not required by any active Rule, may coexist with a scope-limited `PROCEED` through Scope `not_checked` rather than a non-blocking `unknown`.
- A real recorded Fixture can support scope-limited classification and an explicitly labeled Replay or Demo result. It cannot replace Evidence from the user's current Live Run.
- Mock and Replay markers must not contradict the authoritative Run mode and Evidence provenance.

Each Rule Contract declares its own Evidence Requirements. A separate free-form list of critical Evidence keys must not become an independent source of Verdict behavior.

The merged Evidence Baseline classification is an adapter input, not a public Rule Status or a second source of Verdict truth:

| Baseline classification | P0 v0.1 translation |
|---|---|
| `COMPLETE` | May support `P0-EVIDENCE-001 = PASS` only when all Evidence required by the current execution path satisfies this Contract and the Rule Result carries resolving Evidence references. |
| `MISSING` | Must be decomposed by inspecting the underlying cause; the public Contract must not expose a generic `MISSING` Rule Result. Missing, incomplete, or unreliable required Evidence maps to the applicable legal `P0-EVIDENCE-001 = UNKNOWN / Reason Code`. A non-empty unclassified Warning maps to `UNCLASSIFIED_WARNING`. A verified Warning does not remain Evidence-incomplete merely because the legacy Baseline classifies every non-empty Warning as `MISSING`. |
| `UNKNOWN` caused by non-`OK` Integration Status | Produces the Integration Error envelope and the interrupted Rule or Check Scope `unknown`; it must not fabricate `P0-EVIDENCE-001 = UNKNOWN`. |
| Any other baseline `UNKNOWN` | Must be decomposed into a declared Rule or Scope reason before entering the public envelope; an unclassified generic `UNKNOWN` is invalid. |

## 4. Central Verdict Policy: Conservative Total Function

The central policy is the only source of the final verdict. The frontend, individual rules, and natural-language copy must not generate a global verdict independently.

1. If public `systemStatus = INTEGRATION_ERROR`, return `UNKNOWN`. Provide only applicable system-recovery actions and do not generate a protocol-risk conclusion.
2. If any blocking Rule is `UNKNOWN` or any Scope Item is `unknown`, return `UNKNOWN` and do not allow `PROCEED`.
3. If `ROUTE_AVAILABILITY = FAIL / NO_ROUTE_FOUND` has passed the Classification Gate and no other rule required on the current path has a blocking `UNKNOWN`, return `STOP`.
4. If `OUTPUT_MEETS_BOUNDARY = FAIL` and no blocking `UNKNOWN` exists, return `ADJUST` only when a transaction adjustment has passed the Action Recommendation Gate against the unchanged boundary; otherwise return `STOP` for the current transaction.
5. If the system is healthy, all Rules required on the current path are `PASS` or `NOT_APPLICABLE`, no Scope Item is `unknown`, and no blocking Rule exists, return a scope-limited `PROCEED`.
6. Return `UNKNOWN` for every combination not covered by the preceding reviewed policy vectors. Do not invent a new priority.

There is no generic "adjustable Rule" fallback. Every Rule Result combination that may produce `ADJUST` requires an explicit central-policy entry, an Action Recommendation Gate, and reviewed test vectors.

The conservative precedence for blocking results is:

```text
blocking UNKNOWN > STOP > ADJUST > PROCEED
```

`blocking` is centralized Verdict Policy behavior, not a boolean that an individual Rule Result may freely declare. P0 defines the following mappings:

| Rule Result | Central policy behavior |
|---|---|
| `P0-EVIDENCE-001 = UNKNOWN` | blocking `UNKNOWN` |
| `P0-EXECUTION-001 = UNKNOWN`, when applicable | blocking `UNKNOWN` |
| `P0-EXECUTION-001 = FAIL / NO_ROUTE_FOUND`, after the Classification Gate | `STOP` |
| `P0-ECONOMIC-001 = UNKNOWN`, when applicable | blocking `UNKNOWN` |
| `P0-ECONOMIC-001 = FAIL / OUTPUT_BELOW_BOUNDARY` | `ADJUST` after the Action Recommendation Gate; otherwise `STOP` |
| Any uncovered Rule Result combination | `UNKNOWN` |

Disclosure-only or unchecked information belongs in Scope Disclosure as `not_checked` rather than an ad hoc non-blocking Rule or Scope `UNKNOWN`. P0 v0.1 has no non-blocking `UNKNOWN`; any future exception requires a versioned Contract change and reviewed policy vectors.

An `UNKNOWN` result does not remove local facts already confirmed by other rules, but the aggregation layer may prevent candidate transaction actions from entering the current `recommendedActions`.

## 5. Rule P0-EVIDENCE-001: EVIDENCE_COMPLETENESS

### 5.1 Rule Definition

```text
ruleId = P0-EVIDENCE-001
ruleName = EVIDENCE_COMPLETENESS
```

Purpose: Prevent the system from silently promoting partial success, zero warnings, or default values into a trusted transaction conclusion when evidence required by the current execution path is missing, incomplete, of unknown origin, or not reproducible.

### 5.2 Applicability

Evidence requirements must be calculated from the current execution path and terminal stage:

- `simulationCoverage` is required only when the current path must enter `SIMULATE`.
- If an earlier stage has already ended with a trusted terminal result, later stage-level checks that were never entered are represented as Scope `not_checked` and, where a downstream Rule has a legal status for an unentered stage, as that Rule's `NOT_APPLICABLE` result. This does not make `P0-EVIDENCE-001` `NOT_APPLICABLE`.
- Raw evidence fields must not themselves be written as `NOT_APPLICABLE`; applicability is expressed by rule and stage evaluation.

### 5.3 Triggers and Reason Codes

When the current path requires `SIMULATE`:

- Missing `simulationCoverage.value` -> `UNKNOWN / SIMULATION_COVERAGE_MISSING`
- `simulationCoverage.value.complete !== true` -> `UNKNOWN / SIMULATION_COVERAGE_MISSING`
- Simulation halted -> `UNKNOWN / SIMULATION_HALTED`

Other triggers:

- Critical evidence required by the current path is missing -> `UNKNOWN / CRITICAL_EVIDENCE_MISSING`
- A Moss warning has no verified interpretation -> `UNKNOWN / UNCLASSIFIED_WARNING`
- A critical asset change cannot be explained -> `UNKNOWN / UNEXPLAINED_ASSET_CHANGE`
- The source of critical evidence is unknown -> `UNKNOWN / EVIDENCE_SOURCE_UNKNOWN`
- Critical evidence is not reproducible -> `UNKNOWN / EVIDENCE_NOT_REPRODUCIBLE`
- Quote and Simulation output conflict without a verified explanation -> `UNKNOWN / OUTPUT_SOURCE_CONFLICT`

Stage and Rule Contracts must define the critical evidence required by the current path. No consumer may infer those requirements ad hoc.

### 5.4 Actions and Non-Inference Boundary

When this rule triggers, only applicable `SYSTEM_RECOVERY` actions may enter `recommendedActions`:

- `RETRY_CHECK`
- `VIEW_MISSING_EVIDENCE`
- `USE_REPLAY`, only in an explicitly labeled Replay or Demo fallback

This rule alone cannot support adjusting the amount, token pair, protocol, or slippage. It also must not infer that:

- the protocol or transaction is dangerous;
- the transaction itself has failed;
- a particular transaction parameter caused the failure;
- changing a transaction parameter will improve the result;
- zero warnings means no risk exists; or
- the current Run may return `PROCEED`.

## 6. Rule P0-EXECUTION-001: ROUTE_AVAILABILITY

### 6.1 Rule Definition

```text
ruleId = P0-EXECUTION-001
ruleName = ROUTE_AVAILABILITY
```

Purpose: When Parallax can reliably confirm that no route is available for the current protocol, token pair, and transaction conditions, stop the current path without requiring evidence that would only be produced by later stages.

### 6.2 Required Evidence

When `NO_ROUTE` is produced by Parallax `normalizeMossError()` from a constrained raw error message rather than from a native structured Moss output, the normalized result is:

```text
NormalizedMossError.code = NO_ROUTE
NormalizedMossError.integrationStatus = OK
```

The rule requires at least:

- a reference to the raw Moss error, quote, or action output;
- normalized error code `NO_ROUTE`;
- error stage and evidence source;
- the current intent, protocol, and token pair;
- structured status that excludes RPC, adapter, decoding, timeout, and other integration errors; and
- the applicable Runtime Version or Revision and Fixture scope.

A Fixture with `RULE_TEST_INPUT`, `real = false`, or `source = mock` can validate code mapping only. It cannot validate a real product decision.

### 6.3 Stage Applicability Matrix

| Confirmed terminal stage | Required evidence | `NOT_APPLICABLE` |
|---|---|---|
| `QUOTE` | Quote Error, Normalized Error, Intent, Protocol, Token Pair, Provenance | Action, Simulation, Simulation Coverage |
| `ACTION` | Quote, Action Construction Error, Normalized Error, Intent, Protocol, Token Pair, Provenance | Simulation, Simulation Coverage |

Before treating missing stage evidence as `UNKNOWN`, first determine whether that stage was required to occur on the current path. Later-stage Rules that were not entered because of this trusted terminal result use `NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT`.

### 6.4 Rule Result and Policy Mapping

When trustworthy current-Run Evidence confirms that a Route is available for the current Intent, Protocol, Token Pair, and transaction conditions:

```text
status = PASS
```

The absence of a classified `NO_ROUTE` result is not sufficient to produce `PASS`.

When trustworthy classification evidence confirms that no Route is available for the current path:

```text
status = FAIL
reasonCode = NO_ROUTE_FOUND
```

The central policy then maps the following tuple to `STOP`:

```text
(P0-EXECUTION-001, FAIL, NO_ROUTE_FOUND)
```

The Rule Result itself does not declare the final verdict.

When Route Availability is required but the available result cannot satisfy the Rule classification requirements, including when only a synthetic Fixture supports the classification:

```text
status = UNKNOWN
reasonCode = RULE_CLASSIFICATION_NOT_VERIFIED
```

An Integration Error that interrupts this check does not manufacture an `UNKNOWN` Rule Result. It leaves the unfinished Rule Result absent and records the required check as Scope `unknown`, as defined in Sections 3.2 and 3.7.

### 6.5 Reason-to-Action Mapping

| Parameter | Relevance | Basis | User recommendation gate |
|---|---|---|---|
| Protocol | `RELEVANT` | Changing the execution venue may make another route available. | Action Gate |
| Token Pair | `RELEVANT` | Changing the market may make a new route available. | Action Gate |
| Slippage | `UNKNOWN` | The current Fixture does not yet prove that the normalized `NO_ROUTE` mapping excludes slippage-related quote constraints. | Do not recommend |
| `amountIn` | `UNKNOWN` | Trade size may affect liquidity or quoting, but no real Fixture currently verifies this relationship. | Do not recommend |
| Minimum Received | `IRRELEVANT` | It changes only the user's acceptance boundary and cannot create a route. | Classification Gate |

Action Reason Codes for this mapping include:

- verified alternative Protocol or Token Pair: `ALTERNATIVE_PATH_VERIFIED`;
- Minimum Received after the Classification Gate: `CHANGES_ACCEPTANCE_BOUNDARY_ONLY`; and
- Slippage or Amount without sufficient causal Evidence: `EFFECT_NOT_VERIFIED`.

Slippage may be upgraded to scope-limited `IRRELEVANT` only after a real Fixture proves that the verified Protocol, Runtime Revision, stage, and raw-error mapping exclude slippage-related constraints.

### 6.6 Independent Verification Gates

#### Classification / Verdict Gate

Goal: Verify that `NO_ROUTE_FOUND -> STOP` is a trustworthy classification for a specific protocol, Runtime Version, stage, and raw-error mapping.

Minimum requirements:

- one real raw Moss output;
- reproducible raw-to-normalized `NO_ROUTE` mapping;
- verified exclusion of integration errors; and
- traceable protocol, token pair, Runtime Version or Revision, and Replay or Live status.

The Gate allows `STOP` only within the verified scope. One Fixture must not globally activate the verdict for every protocol and error format.

#### Action Recommendation Gate

Goal: Verify that changing the Protocol or Token Pair can produce a new executable path instead of being merely plausible in principle.

Minimum requirements:

- an alternative Protocol or Token Pair; or
- a rerun after the change; and
- a new result demonstrating an actionable relationship between the recommendation and `NO_ROUTE_FOUND`.

If the Classification Gate passes but the Action Recommendation Gate does not, the system may return a scope-limited `STOP` but must not recommend a specific unverified transaction adjustment.

### 6.7 Replay and Live Boundary

A real recorded Fixture can validate Rule classification and may support an explicitly labeled Replay or Demo Verdict when the authoritative Run mode identifies that flow. It cannot replace Evidence from the user's current Live Run.

Every Live `STOP` must still be supported by raw and normalized evidence from the current Run. A Replay verdict must not be presented as a Live verdict.

### 6.8 Non-Inference Boundary

This rule must not infer that:

- the protocol as a whole is unavailable or unsafe;
- no route or token pair exists anywhere;
- increasing slippage or priority fee will create a route;
- changing Minimum Received will improve the transaction result;
- an integration error is equivalent to `NO_ROUTE`;
- a synthetic Fixture proves that a real user-facing `STOP` is trustworthy; or
- one real Fixture validates every action recommendation.

## 7. Rule P0-ECONOMIC-001: OUTPUT_MEETS_BOUNDARY

### 7.1 Rule Definition

```text
ruleId = P0-ECONOMIC-001
ruleName = OUTPUT_MEETS_BOUNDARY
```

Purpose: Determine whether the simulated amount actually received for `tokenOut` satisfies the user's original Economic Boundary without replacing missing execution evidence with a Quote estimate or changing the boundary to manufacture `PROCEED`.

### 7.2 Applicability

- If no usable Minimum Received exists, return `NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED`.
- If a trusted earlier terminal result, such as classified `NO_ROUTE_FOUND`, means the execution path never enters Simulation, return `NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT`.
- If the current path requires Simulation but Simulation is missing, incomplete, halted, unreliable, or cannot produce a trustworthy received `tokenOut` amount, return `UNKNOWN / SIMULATED_OUTPUT_UNAVAILABLE`.
- If the simulated asset change cannot be matched to both the intended recipient and intended `tokenOut`, return `UNKNOWN / SIMULATED_OUTPUT_UNAVAILABLE`.
- Evaluate `PASS` or `FAIL` only after the required Simulation and Evidence provenance requirements are satisfied.

### 7.3 Comparator and Source Priority

The comparator is the normalized simulated amount received by the intended recipient for the intended `tokenOut`. It must be derived from a validated recipient balance delta or equivalent asset change, rather than accepted solely because a generic field is named `outcome`.

The following Quote values are supplementary Evidence only:

- `estimatedAmountOut` is an estimate, not a completed simulated result.
- `quote.minimumAmountOut` is the transaction or protocol slippage guard, not the user's declared boundary and not an observed output.

Neither Quote value may replace missing Simulation evidence to produce final Economic `PASS` or `FAIL`.

Comparison semantics:

```text
simulatedReceived >= minimumReceived -> PASS
simulatedReceived < minimumReceived  -> FAIL / OUTPUT_BELOW_BOUNDARY
```

Equality therefore returns `PASS`.

If Quote and Simulation conflict, preserve the local Economic comparison derived from Simulation and record the discrepancy separately. An unexplained critical conflict produces `P0-EVIDENCE-001 = UNKNOWN / OUTPUT_SOURCE_CONFLICT`; Quote must not silently override Simulation.

### 7.4 Verdict and Action Mapping

Economic `PASS` does not independently produce `PROCEED`. Economic `NOT_APPLICABLE` does not independently block `PROCEED`.

For Economic `FAIL`:

- return `ADJUST` only when a `TRANSACTION_ADJUSTMENT` is `RELEVANT`, `recommendable = true`, and a rerun or equivalent Action Gate proves that the changed transaction can satisfy the unchanged original boundary;
- otherwise return `STOP` for the current transaction when no blocking `UNKNOWN` exists; and
- return global `UNKNOWN` when any blocking Rule `UNKNOWN` exists, while preserving the Economic `FAIL` in `ruleResults` and showing only applicable system-recovery actions.

Lowering Minimum Received is an `ACCEPTANCE_BOUNDARY_CHANGE`, not a transaction improvement. It must not enter `recommendedActions` or be used to convert Economic `FAIL` into `ADJUST` or `PROCEED`. If the user independently changes the boundary, the system treats it as a new Intent and Run.

### 7.5 Non-Inference Boundary

This rule must not infer that:

- a Quote estimate proves the simulated execution result;
- a protocol-generated `minimumAmountOut` is the user's own Minimum Received;
- the protocol as a whole is unsafe because the current transaction misses the boundary;
- a plausible transaction change will improve the result without Action Gate Evidence; or
- changing the user's acceptance threshold improves the transaction outcome.

## 8. Initial Test Vectors

### TV-001: Required Coverage Value Is Missing

```text
Given:
  systemStatus = OK
  SIMULATE is required for the current path
  simulationCoverage.value = null

Expect:
  P0-EVIDENCE-001.status = UNKNOWN
  reasonCode = SIMULATION_COVERAGE_MISSING
  Decision.verdict = UNKNOWN
  recommendedActions contains only applicable SYSTEM_RECOVERY actions
  recommendedActions does not contain TRANSACTION_ADJUSTMENT
```

### TV-ECO-001: Economic Fail with Blocking Evidence Unknown

```text
Given:
  Economic Boundary Rule = FAIL / OUTPUT_BELOW_BOUNDARY
  Evidence Completeness Rule = UNKNOWN / SIMULATION_COVERAGE_MISSING

Expect:
  Decision.verdict = UNKNOWN
  recommendedActions contains only SYSTEM_RECOVERY actions
  Economic Boundary FAIL remains in ruleResults
  related Protocol / Amount candidate actions do not enter recommendedActions
```

### TV-ECO-002: Minimum Received Is Not Provided

```text
Given:
  systemStatus = OK
  required execution evidence is complete
  minimumReceived is absent
  minimumReceivedSource = unavailable

Expect:
  Economic Boundary Rule = NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED
  this status alone does not prevent other rules from producing a scope-limited PROCEED
```

### TV-ECO-003: Quote Exists but Simulated Output Is Unavailable

```text
Given:
  minimumReceived is available
  estimatedAmountOut is available
  quote.minimumAmountOut is available
  SIMULATE is required
  no trustworthy simulated tokenOut received amount exists

Expect:
  P0-ECONOMIC-001.status = UNKNOWN
  reasonCode = SIMULATED_OUTPUT_UNAVAILABLE
  neither Quote value is used as a fallback for PASS or FAIL
  Decision.verdict = UNKNOWN
```

### TV-ECO-004: Simulated Output Equals the Boundary

```text
Given:
  required Simulation Evidence is complete
  simulatedReceived = minimumReceived

Expect:
  P0-ECONOMIC-001.status = PASS
  this PASS alone does not determine PROCEED
```

### TV-ECO-005: Economic Fail Without a Verified Adjustment

```text
Given:
  P0-ECONOMIC-001.status = FAIL
  reasonCode = OUTPUT_BELOW_BOUNDARY
  no blocking Rule UNKNOWN exists
  no transaction adjustment has passed the Action Recommendation Gate

Expect:
  Decision.verdict = STOP
  recommendedActions does not contain an unverified transaction adjustment
  lowering Minimum Received is not recommended
```

### TV-ECO-006: Economic Fail with a Verified Adjustment

```text
Given:
  P0-ECONOMIC-001.status = FAIL
  reasonCode = OUTPUT_BELOW_BOUNDARY
  no blocking Rule UNKNOWN or higher-priority STOP exists
  a transaction adjustment rerun satisfies the unchanged original boundary

Expect:
  Decision.verdict = ADJUST
  the verified transaction adjustment may enter recommendedActions
```

### TV-002: Internal Integration Error

```text
Given:
  internal integrationStatus = INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT

Expect:
  public status = integration_error
  public systemStatus = INTEGRATION_ERROR
  no protocol-risk or transaction-risk Rule FAIL is generated
  Decision.verdict = UNKNOWN
  Decision.verdict is the single canonical public Verdict and represents an incomplete check
  error.code preserves the specific collapsed cause
  error.stage preserves the failed integration stage
  error.retryable is explicit
  only applicable SYSTEM_RECOVERY actions enter recommendedActions
  no transaction adjustment or acceptance-boundary change is recommended
  Scope Disclosure identifies checks that were not completed
```

### TV-003: Structured No Route at Quote Stage

```text
Given:
  internal integrationStatus = OK
  normalizedError.code = NO_ROUTE
  normalizedError.stage = QUOTE
  Classification Gate is satisfied for the current scope

Expect:
  P0-EXECUTION-001.status = FAIL
  reasonCode = NO_ROUTE_FOUND
  Action / Simulation / Simulation Coverage = NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT at rule-stage level
  Decision.verdict = STOP
```

### TV-004: Structured No Route at Action Stage

```text
Given:
  internal integrationStatus = OK
  normalizedError.code = NO_ROUTE
  normalizedError.stage = ACTION
  Classification Gate is satisfied for the current scope

Expect:
  Action Construction Error is required evidence
  Simulation / Simulation Coverage = NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT at rule-stage level
  P0-EXECUTION-001.status = FAIL
  reasonCode = NO_ROUTE_FOUND
  Decision.verdict = STOP
```

### TV-005: Integration Error Containing Route Text

```text
Given:
  raw error message contains the word "route"
  normalized integrationStatus = INTEGRATION_ERROR

Expect:
  the error is not mapped to NO_ROUTE_FOUND
  no protocol FAIL or STOP is generated
  Decision.verdict = UNKNOWN
  applicable SYSTEM_RECOVERY actions enter recommendedActions
```

### TV-006: Only a Synthetic No Route Fixture Exists

```text
Given:
  Contract / unit test input contains structured NO_ROUTE
  Fixture is mock / RULE_TEST_INPUT
  Classification Gate is not satisfied

Expect:
  the input may validate the code path and Contract shape
  it must not produce a user-visible STOP
  the user-visible Decision falls back to UNKNOWN
  P0-EXECUTION-001.status = UNKNOWN
  reasonCode = RULE_CLASSIFICATION_NOT_VERIFIED
```

### TV-007: Classification Gate Passes but Action Gate Does Not

```text
Given:
  real Raw -> Normalized NO_ROUTE is verified for the current scope
  no before / after alternative Protocol or Token Pair Evidence exists

Expect:
  Decision.verdict = STOP
  no Protocol or Token Pair recommendation enters recommendedActions
  confirmed irrelevant actions may enter irrelevantActions
```

### TV-008: Uncovered Rule Result Combination

```text
Given:
  a Rule Result combination has no reviewed VerdictPolicy test vector

Expect:
  Decision.verdict = UNKNOWN
  no consumer independently infers a priority
```

### TV-009: No Route with Blocking Evidence Unknown

```text
Given:
  P0-EXECUTION-001 = FAIL / NO_ROUTE_FOUND
  P0-EVIDENCE-001 = UNKNOWN / CRITICAL_EVIDENCE_MISSING

Expect:
  Decision.verdict = UNKNOWN
  the Route FAIL remains in ruleResults
  only applicable SYSTEM_RECOVERY actions enter recommendedActions
  unverified transaction adjustments do not enter either public action list
```

### TV-010: All Required Rules Are Satisfied or Not Applicable

```text
Given:
  systemStatus = OK
  every Rule required by the current path is PASS or NOT_APPLICABLE
  every NOT_APPLICABLE Rule includes an applicabilityReasonCode
  no Scope Item is unknown
  no uncovered Rule Result combination exists

Expect:
  Decision.verdict = PROCEED
  PROCEED remains limited to the checked scope
```

### TV-ACTION-001: Invalid or Unverified Action Combinations

```text
Expect Contract rejection:
  relevance = IRRELEVANT and recommendable = true
  relevance = UNKNOWN and recommendable = true
  a public Action with no resolving ActionSupportRef
  a recommendable transaction adjustment without a concrete proposed Intent change
  a recommendable transaction adjustment without supporting EvidenceRef or Action Gate result

Expect public filtering:
  only verified RELEVANT actions enter recommendedActions
  only verified IRRELEVANT actions enter irrelevantActions
  UNKNOWN or unverified candidates remain internal and enter neither public list
```

### TV-ACTION-003: System Recovery Uses Error or Scope Support

```text
Given:
  status = integration_error
  error.retryable = true
  no transaction Evidence exists

Expect:
  RETRY_CHECK may be publicly recommendable
  the Action has a stable unique identity
  an ErrorRef resolves to the structured Run error
  an empty EvidenceRef list alone does not invalidate this SYSTEM_RECOVERY Action
  the Action contains no proposed transaction change
```

### TV-SCOPE-001: Trusted Terminal Result Does Not Manufacture Unknown

```text
Given:
  P0-EXECUTION-001 = FAIL / NO_ROUTE_FOUND
  the trusted terminal stage is QUOTE
  Simulation is not entered by design

Expect:
  Route Availability Scope = checked
  Simulation and Economic Output Scope = not_checked
  P0-ECONOMIC-001 = NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT
  no Scope unknown is created for the unentered later stage
```

### TV-SCOPE-002: Integration Timeout Preserves Partial Scope

```text
Given:
  Route Availability completed with trustworthy Evidence
  a later required Simulation call times out

Expect:
  public status = integration_error
  public systemStatus = INTEGRATION_ERROR
  public verdict = UNKNOWN
  Route Availability Scope = checked
  Simulation Scope = unknown
  the completed Route Rule Result and Evidence remain present
  no unfinished Simulation Rule Result is fabricated
```

### TV-SCOPE-003: Rule and Scope Status Must Agree

```text
Expect Contract rejection:
  P0-EXECUTION-001 = PASS with its Rule-bound Scope Item = unknown
  P0-EVIDENCE-001 = UNKNOWN with its Rule-bound Scope Item = checked
  P0-ECONOMIC-001 = NOT_APPLICABLE with its Rule-bound Scope Item = checked
  duplicate Scope Items for the same Rule or Check subject

Expect valid Integration Error representation:
  a required unfinished Rule Result is absent
  its Rule-bound Scope Item = unknown / REQUIRED_CHECK_INTERRUPTED
```

### TV-CONTRACT-001: Invalid Rule Tuples and References

```text
Expect Contract rejection:
  duplicate ruleId values in one Run
  P0-EXECUTION-001 / FAIL / OUTPUT_BELOW_BOUNDARY
  P0-ECONOMIC-001 / UNKNOWN / NO_ROUTE_FOUND
  P0-EXECUTION-001 / PASS with any Reason Code
  any Rule tuple absent from the exhaustive P0 v0.1 outcome table
  PASS or FAIL without supporting Evidence references
  NOT_APPLICABLE without an applicabilityReasonCode
  an Evidence reference that does not resolve within the same Run
```

### TV-BOUNDARY-001: Available Boundary with a Trusted Earlier Terminal Result

```text
Given:
  Minimum Received is available
  P0-EXECUTION-001 = FAIL / NO_ROUTE_FOUND at QUOTE
  Simulation is not entered

Expect:
  Boundary context remains available
  P0-ECONOMIC-001 = NOT_APPLICABLE / STAGE_NOT_ENTERED_AFTER_TERMINAL_RESULT
  NOT_APPLICABLE / BOUNDARY_NOT_PROVIDED is rejected
```

### TV-ACTION-002: Public Recommendation Is a Concrete Verified Change

```text
Given:
  a transaction Action is classified RELEVANT
  no proposed target value or rerun Evidence exists

Expect:
  recommendable = false
  the candidate remains internal
  it does not enter recommendedActions

Given:
  a concrete proposed Intent change is rerun
  the rerun verifies the claimed effect

Expect:
  recommendable = true may be valid
  the public Action identifies the concrete proposed change
  the verified rerun Evidence is represented in the canonical Evidence collection
  the Action Evidence references resolve within that collection
```

### TV-ENVELOPE-001: Failed Re-run Preserves Intent Diff

```text
Given:
  a child Run changes Protocol from Kuru to Pancake
  the child Run ends with an Integration Error

Expect:
  parentRunId remains present
  diff remains present and identifies the Protocol change
  status = integration_error
  systemStatus = INTEGRATION_ERROR
  verdict = UNKNOWN
  no transaction adjustment is publicly recommended from the error
```

### TV-ENVELOPE-002: Invalid Intent Is Not an Integration Error Run

```text
Given:
  the untrusted request fails Intent validation or amount normalization

Expect:
  the API returns a structured validation result
  no integration_error Run is manufactured
  no systemStatus or transaction Verdict is inferred
```

### TV-ENVELOPE-003: Run Branches Are Mutually Exclusive

```text
Expect Contract rejection:
  status = completed with systemStatus = INTEGRATION_ERROR
  status = completed with an error
  status = integration_error with systemStatus = OK
  status = integration_error without an error
  status = integration_error with verdict other than UNKNOWN
  any independently authored second public Verdict

Expect valid Completed incomplete-check representation:
  status = completed
  systemStatus = OK
  verdict = UNKNOWN
  applicable SYSTEM_RECOVERY Actions may enter recommendedActions
```

### TV-BASELINE-001: Baseline Status Is Translated, Not Exposed

```text
Given:
  legacy Evidence Baseline = MISSING because a non-empty Warning is unclassified

Expect:
  P0-EVIDENCE-001 = UNKNOWN / UNCLASSIFIED_WARNING
  no generic public MISSING Rule Status exists
  Warning text does not independently produce FAIL, ADJUST, or STOP

Given:
  legacy Evidence Baseline = UNKNOWN because integrationStatus is not OK

Expect:
  status = integration_error
  the interrupted Rule or Check Scope = unknown / REQUIRED_CHECK_INTERRUPTED
  no P0-EVIDENCE-001 Rule Result is fabricated from the Integration Error
```

## 9. Implementation and Activation TODOs

The semantic requirements in Sections 1 through 8 are normative for P0 v0.1. The following items implement or validate that contract; they are not open invitations to redefine it independently.

### 9.1 Shared Contract and API Implementation

- [ ] Implement sealed Rule-specific `RuleResult` schemas and reject invalid Rule ID, Status, Reason Code, and Applicability Reason combinations.
- [ ] Implement one canonical Scope collection with stable Rule or Check subject bindings, the closed Status-valid reason vocabulary, unique subjects, and the Rule-to-Scope invariants defined in Section 3.2.
- [ ] Replace flat `reasons`, independently authored `recommendations`, and legacy `adjustments` with public `RuleResult` and Action projections derived from `ActionEvaluation`.
- [ ] Keep unverified candidate Actions internal to Risk and Aggregation; do not expose a public `candidateActions` collection.
- [ ] Implement the three Action kinds, stable Action identity, the P0 Action target taxonomy, concrete proposed-change payloads, `ActionSupportRef` resolution, and ActionEvaluation combination invariants.
- [ ] Remove public free-form `nonInferenceCodes` and ensure explanatory copy is derived from stable Rule, Action, Scope, and System mappings.
- [ ] Implement canonical Evidence identity, unique keys, reference resolution, source-aware provenance, reproducibility, Runtime or Revision context, and Replay, Fixture, and Mock invariants.
- [ ] Implement one authoritative Run mode representation and reject contradictory Live, Replay, Demo, Fixture, and Mock combinations.
- [ ] Implement the mutually exclusive Completed and Integration Error Run envelope, including the single canonical public Verdict, partial Rule Results, Scope, optional Route Evidence, Boundary context, branch-specific Action constraints, metadata, and Re-run Diff preservation.
- [ ] Include Protocol, Slippage when supported, and the other P0 transaction conditions in normalized Intent and Re-run Diff; implement the PRD `Route / Protocol` adjustment through the P0 `protocol` target and do not expose Moss Route Evidence as a user-editable Action target.
- [ ] Keep Economic Boundary context separate from `P0-ECONOMIC-001` Rule Status.
- [ ] Implement deterministic internal Integration Status to public `status`, `systemStatus`, `verdict`, and structured `error` mapping, including closed versioned `error.code` and `error.stage` enumerations.
- [ ] Implement `P0-ECONOMIC-001 / OUTPUT_MEETS_BOUNDARY` and convert TV-ECO-001 through TV-ECO-006 into Contract and policy tests.
- [ ] Convert all Scope, Action, Contract, Baseline, Boundary, and Envelope vectors in Section 8 into automated Shared Contract tests.

### 9.2 Evidence, Rules, Fixtures, and Gates

- [ ] Implement stage-aware `P0-EVIDENCE-001` Rule Result handling: `PASS` when Evidence required by the current path is complete, and `UNKNOWN` when required Evidence is missing, null, incomplete, unreliable, or unverified. `P0-EVIDENCE-001` never emits `NOT_APPLICABLE`; later unentered stages are represented by Scope `not_checked` and, where legal, the downstream Rule's `NOT_APPLICABLE` result.
- [ ] Implement the merged Evidence Baseline adapter mapping: `COMPLETE` may support Rule `PASS`, `MISSING` is decomposed by its underlying cause rather than directly serialized, and Integration Error `UNKNOWN` produces Scope `unknown` without a fabricated Rule Result.
- [ ] Add Contract and Risk regression coverage preventing `ACCEPTANCE_BOUNDARY_CHANGE` from entering `recommendedActions`.
- [ ] Define and test the normalized recipient-and-token-matched simulated output extraction used by `P0-ECONOMIC-001`.
- [ ] Add a real or sanitized recorded Fixture for simulated output provenance and an explicit Quote-versus-Simulation conflict vector.
- [ ] Obtain a sanitized real `NO_ROUTE` raw Moss output, normalized Evidence, Runtime Revision, and Fixture metadata.
- [ ] Verify the exact scope of the `NO_ROUTE` Classification Gate.
- [ ] Re-evaluate Slippage relevance using a real `NO_ROUTE` Fixture scoped to Protocol, Runtime Revision, stage, and raw-error mapping.
- [ ] Validate the Action Recommendation Gate with a concrete alternative Protocol, Token Pair, Amount, Slippage change, or other reviewed rerun.
- [ ] Convert all reviewed vectors into automated Shared Contract, Risk Engine, aggregation, and API serializer tests.
- [ ] Implement the concrete Evidence Requirements declared by each active P0 Rule without introducing a free-form global critical-key list.
- [ ] Implement and test Warning normalization against the frozen P0 rule boundary: unclassified Warnings produce `UNKNOWN`, and verified Warnings may only support an independently established legal Rule tuple. A complete future Warning taxonomy remains follow-up work.
- [ ] Define future Rule-specific allowlists, if any, for External Evidence sources. Until then, External Evidence remains non-authoritative for core P0 `PASS` and `FAIL`.
- [ ] Keep user-visible `STOP`, `ADJUST`, and other runtime activation disabled until the applicable real Evidence, Classification, Economic Boundary, and Action Recommendation Gates pass.

Real Fixtures must not contain private keys, access credentials, non-public RPC endpoints, or unnecessary user-identifying information.
