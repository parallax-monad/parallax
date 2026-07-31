# Parallax P0 Rule and Reason-to-Action Specification v0.1

> Status: Non-normative, docs-only proposal
> Product source of truth: `docs/product/prd_cn.md` (PRD v0.4)
> Runtime impact: None. This document proposes rule, contract, and test semantics; it does not activate any product verdict.

## 1. Purpose

This specification proposes stable rule semantics that can be shared across the risk engine, shared contracts, API, frontend, and tests. It builds on the existing evidence, normalization, simulation-coverage, error-isolation, and baseline-verdict concepts.

It does not attempt to define a complete risk taxonomy. Version 0.1 provides the first reviewable vertical slice and identifies the evidence, contract, aggregation, and activation gates that remain unresolved.

## 2. Scope

### Included

- Separate individual rule results from the global user verdict.
- Define machine-readable rule statuses, rule IDs, and reason codes.
- Separate transaction adjustments, acceptance-boundary changes, and system-recovery actions.
- Define a conservative total function for centralized verdict aggregation.
- Propose `P0-EVIDENCE-001 / EVIDENCE_COMPLETENESS`.
- Propose `P0-EXECUTION-001 / ROUTE_AVAILABILITY`.
- Provide initial vectors that can become contract and rule tests.

### Excluded

- Runtime changes or activation.
- Complete Live and Replay infrastructure.
- A complete warning and cause taxonomy.
- Transaction-parameter recommendations that lack real evidence.
- Final user-facing copy and information architecture.

## 3. v0.1 Design Proposal

### 3.1 Rule Status Describes Whether a Positive Requirement Holds

Rule names state the positive requirement being checked. Reason codes record why that requirement failed or could not be evaluated. This avoids inverted semantics such as treating `NO_ROUTE_FOUND` itself as the name of a rule that returns `FAIL`.

```ts
type RuleStatus =
  | "PASS"
  | "FAIL"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

type P0RuleId =
  | "P0-EVIDENCE-001"
  | "P0-EXECUTION-001";

type P0ReasonCode =
  | "SIMULATION_COVERAGE_MISSING"
  | "SIMULATION_HALTED"
  | "CRITICAL_EVIDENCE_MISSING"
  | "UNCLASSIFIED_WARNING"
  | "UNEXPLAINED_ASSET_CHANGE"
  | "EVIDENCE_SOURCE_UNKNOWN"
  | "EVIDENCE_NOT_REPRODUCIBLE"
  | "NO_ROUTE_FOUND"
  | "RULE_CLASSIFICATION_NOT_VERIFIED";

type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";
```

Semantics:

- `PASS`: Evidence is sufficient and the rule requirement is satisfied. This does not mean the transaction is safe overall.
- `FAIL`: Evidence is sufficient and the rule requirement is violated.
- `UNKNOWN`: The rule applies, but the available evidence is insufficient or unreliable.
- `NOT_APPLICABLE`: The rule precondition does not exist, or the current execution path does not enter the relevant stage.

### 3.2 Reason Codes Drive Aggregation and Tests

Free-form explanations are not aggregation inputs. Aggregation, contract tests, and frontend mapping use stable `ruleId + status + reasonCode` tuples.

```text
(P0-EXECUTION-001, FAIL, NO_ROUTE_FOUND)
  -> VerdictPolicy: STOP

(P0-EVIDENCE-001, UNKNOWN, SIMULATION_COVERAGE_MISSING)
  -> VerdictPolicy: UNKNOWN
```

Natural-language copy may change or be translated, but it must not change machine semantics.

### 3.3 Separate Actions from Action Evaluation

System-recovery actions do not change the transaction and must not be treated as transaction adjustments. When cause-to-action evidence is missing, the system must not recommend changing transaction parameters merely to avoid returning an empty action list.

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

type ActionEvaluation = {
  action: NextAction;
  relevance: "RELEVANT" | "IRRELEVANT" | "UNKNOWN";
  recommendable: boolean;
  reasonCode: P0ReasonCode;
  evidenceRefs: EvidenceRef[];
};
```

Constraints:

- A `TRANSACTION_ADJUSTMENT` changes transaction conditions. It may enter `recommendedActions` only when its relevance is `RELEVANT`, `recommendable = true`, and the Evidence Gate is satisfied.
- An `ACCEPTANCE_BOUNDARY_CHANGE` changes only the user's evaluation threshold; it does not improve the transaction outcome. In P0, it has `recommendable = false` and must not manufacture a `PROCEED` verdict by lowering the boundary.
- A `SYSTEM_RECOVERY` action only helps complete or restore the check. It does not change the transaction outcome.
- `IRRELEVANT` actions enter `irrelevantActions`; consumers must not silently discard them.
- `USE_REPLAY` must be explicitly labeled as a Replay or Demo fallback and must not be presented as evidence from the current Live Run.

Boundary-source constraints:

- `original_swap`: Explicitly provided by the original transaction or DEX intent.
- `user_declared`: Explicitly entered by the user.
- `demo_preset`: Allowed only in clearly labeled Demo or Replay flows; it must not be presented as the user's real boundary.
- `unavailable`: No usable boundary exists, so the Economic Boundary Rule returns `NOT_APPLICABLE`.
- Boundary source must be included in the Decision Receipt and Evidence Disclosure.

### 3.4 Evidence References Preserve Provenance

The following is the minimum v0.1 reference shape. Final field names are frozen in the Shared Contract.

```ts
type EvidenceRef = {
  key: string;
  source: "moss" | "rpc" | "quote" | "external" | "derived" | "mock" | "unknown";
  stage?: "DISCOVER" | "LOAD" | "QUOTE" | "ACTION" | "SIMULATE";
  blockNumber?: string;
  runtimeVersion?: string;
  runtimeRevision?: string;
  fixtureId?: string;
  isReplay: boolean;
  isMock: boolean;
};
```

Mock evidence must not support a core verdict. Replay evidence must preserve its real provenance while setting `isReplay = true`.

### 3.5 Separate Rule Results, Policy, and Decisions

An individual rule reports only its local finding. It does not generate the final verdict or declare a free-form `verdictEffect`.

```ts
type RuleResultBase = {
  ruleId: P0RuleId;
  evidenceRefs: EvidenceRef[];
  actionEvaluations: ActionEvaluation[];
  nonInferenceCodes: string[];
};

type RuleResult = RuleResultBase &
  (
    | {
        status: "PASS" | "NOT_APPLICABLE";
        reasonCode?: never;
      }
    | {
        status: "FAIL" | "UNKNOWN";
        reasonCode: P0ReasonCode;
      }
  );

type EconomicBoundaryContext = {
  minimumReceived?: string;
  source: BoundarySource;
};

type RuleEngineDecision = {
  systemStatus: "OK" | "INTEGRATION_ERROR";
  verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";
  summary: string;
  boundary: EconomicBoundaryContext;
  recommendedActions: ActionEvaluation[];
  irrelevantActions: ActionEvaluation[];
  checked: string[];
  notChecked: string[];
  unknowns: string[];
  evidence: EvidenceRef[];
  ruleResults: RuleResult[];
  replayMode: boolean;
};
```

The API or orchestration layer adds the PRD Reference Contract fields:

- `runId`
- `parentRunId`
- `diff`
- API route and serialization fields

`boundary.source` must be included in the final Decision Receipt. A `demo_preset` source must also be consistent with `replayMode = true` or another explicit Demo marker.

Hiding a transaction adjustment only means it does not enter the current `recommendedActions`. It does not remove a rule result already supported by evidence. Confirmed irrelevant actions must enter `irrelevantActions`.

### 3.6 Map Internal Integration Status to Public System Status

The internal integration layer distinguishes:

```text
OK | INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT
```

PRD v0.4 exposes the following public `systemStatus` values:

```text
OK | INTEGRATION_ERROR
```

Version 0.1 proposes:

```text
OK -> OK
INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT -> INTEGRATION_ERROR
```

The specific cause remains available through a structured error code and must not be lost when public statuses are collapsed.

## 4. Central Verdict Policy: Conservative Total Function

The central policy is the only source of the final verdict. The frontend, individual rules, and natural-language copy must not generate a global verdict independently.

1. If public `systemStatus = INTEGRATION_ERROR`, return `UNKNOWN`. Provide only applicable system-recovery actions and do not generate a protocol-risk conclusion.
2. If any blocking rule is `UNKNOWN`, return `UNKNOWN` and do not allow `PROCEED`.
3. If `ROUTE_AVAILABILITY = FAIL / NO_ROUTE_FOUND` has passed the Classification Gate and no other rule required on the current path has a blocking `UNKNOWN`, return `STOP`.
4. If evidence supports an adjustable rule `FAIL` and no higher-priority `STOP` or blocking `UNKNOWN` exists, return `ADJUST`.
5. If the system is healthy, all rules required on the current path are `PASS` or `NOT_APPLICABLE`, and no blocking rule exists, return a scope-limited `PROCEED`.
6. Return `UNKNOWN` for every combination not covered by the preceding reviewed policy vectors. Do not invent a new priority.

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
- If an earlier stage has already ended with a trusted terminal result, later stages that were never entered are `NOT_APPLICABLE`.
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

Stage and Rule Contracts must define the critical evidence required by the current path. No consumer may infer those requirements ad hoc.

### 5.4 Actions and Non-Inference Boundary

When this rule triggers, only applicable `SYSTEM_RECOVERY` actions may enter `recommendedActions`:

- `RETRY_CHECK`
- `VIEW_MISSING_EVIDENCE`
- `USE_REPLAY`, only in an explicitly labeled Replay or Demo fallback

This rule alone cannot support adjusting the amount, token pair, route, protocol, or slippage. It also must not infer that:

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

Before treating missing stage evidence as `UNKNOWN`, first determine whether that stage was required to occur on the current path.

### 6.4 Rule Result and Policy Mapping

When classification evidence is sufficient:

```text
status = FAIL
reasonCode = NO_ROUTE_FOUND
```

The central policy then maps the following tuple to `STOP`:

```text
(P0-EXECUTION-001, FAIL, NO_ROUTE_FOUND)
```

The Rule Result itself does not declare the final verdict.

### 6.5 Reason-to-Action Mapping

| Parameter | Relevance | Basis | User recommendation gate |
|---|---|---|---|
| Route / Protocol | `RELEVANT` | Changing the execution path or market may make another route available. | Action Gate |
| Token Pair | `RELEVANT` | Changing the market may make a new route available. | Action Gate |
| Priority Fee | `IRRELEVANT` | It affects ordering and inclusion speed but cannot create a route. | Classification Gate |
| Slippage | `IRRELEVANT` | A wider price-movement tolerance cannot replace a missing route. P0 prohibits blindly increasing slippage. | Classification Gate |
| Amount | `UNKNOWN` | Trade size may affect liquidity or quoting, but no real Fixture currently verifies this relationship. | Do not recommend |
| Minimum Received | `IRRELEVANT` | It changes only the user's acceptance boundary and cannot create a route. | Classification Gate |

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

Goal: Verify that changing the route, protocol, or token pair can produce a new executable path instead of being merely plausible in principle.

Minimum requirements:

- an alternative route or token pair; or
- a rerun after the change; and
- a new result demonstrating an actionable relationship between the recommendation and `NO_ROUTE_FOUND`.

If the Classification Gate passes but the Action Recommendation Gate does not, the system may return a scope-limited `STOP` but must not recommend a specific unverified transaction adjustment.

### 6.7 Replay and Live Boundary

A real recorded Fixture can validate rule classification and may support an explicitly labeled Demo verdict when `replayMode = true`. It cannot replace evidence from the user's current Live Run.

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

## 7. Initial Test Vectors

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

### Policy Example PE-001: Economic Fail with Blocking Evidence Unknown

> This example validates the aggregation boundary defined by PRD v0.4. `P0-ECONOMIC-001` is not yet defined by this specification, so this is not currently an executable Rule Contract test.

```text
Given:
  Economic Boundary Rule = FAIL / OUTPUT_BELOW_BOUNDARY
  Evidence Completeness Rule = UNKNOWN / SIMULATION_COVERAGE_MISSING

Expect:
  Decision.verdict = UNKNOWN
  recommendedActions contains only SYSTEM_RECOVERY actions
  Economic Boundary FAIL remains in ruleResults
  related Route / Amount candidate actions do not enter recommendedActions
```

### Policy Example PE-002: Minimum Received Is Not Provided

> This example validates the `NOT_APPLICABLE` semantics defined by PRD v0.4. It can become a Contract Test after the Economic Rule Contract is defined.

```text
Given:
  systemStatus = OK
  required execution evidence is complete
  minimumReceived is absent
  minimumReceivedSource = unavailable

Expect:
  Economic Boundary Rule = NOT_APPLICABLE
  this status alone does not prevent other rules from producing a scope-limited PROCEED
```

### TV-002: Internal Integration Error

```text
Given:
  internal integrationStatus = INTEGRATION_ERROR | UNAVAILABLE | TIMEOUT

Expect:
  public systemStatus = INTEGRATION_ERROR
  no protocol FAIL is generated
  Decision.verdict = UNKNOWN
  applicable SYSTEM_RECOVERY actions enter recommendedActions
  a structured Error Code preserves the specific cause
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
  Action / Simulation / Simulation Coverage = NOT_APPLICABLE at rule-stage level
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
  Simulation / Simulation Coverage = NOT_APPLICABLE at rule-stage level
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
  reasonCode = RULE_CLASSIFICATION_NOT_VERIFIED
```

### TV-007: Classification Gate Passes but Action Gate Does Not

```text
Given:
  real Raw -> Normalized NO_ROUTE is verified for the current scope
  no before / after alternative Route or Token Pair evidence exists

Expect:
  Decision.verdict = STOP
  no Route / Protocol or Token Pair recommendation enters recommendedActions
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

## 8. Open Questions and Implementation TODOs

### 8.1 Contract

- [ ] Decide whether `candidateActions` belongs in the Shared Contract or remains internal to Risk and Aggregation.
- [ ] Replace free-form `reasons / actions` with structured `RuleResult`, Reason Code, and `ActionEvaluation` values.
- [ ] Complete the Contract mapping for `Checked / Not Checked / Unknown`, Boundary Source, and Replay / Mock.
- [ ] Define `P0-ECONOMIC-001 / OUTPUT_MEETS_BOUNDARY`, then promote PE-001 and PE-002 to Contract Tests.

### 8.2 Evidence and Rules

- [ ] Handle `simulationCoverage.value = null` as missing evidence and add a regression test.
- [ ] Remove "change the user's acceptance boundary" from recommended actions.
- [ ] Obtain a sanitized real `NO_ROUTE` raw Moss output, normalized evidence, Runtime Revision, and Fixture metadata.
- [ ] Verify the exact scope of the `NO_ROUTE` Classification Gate.
- [ ] Validate the Action Recommendation Gate with an alternative route, token pair, or rerun.
- [ ] Convert this document's test vectors into automated Shared Contract and Risk Engine tests.
- [ ] Define which warnings always produce `UNKNOWN` in P0 and which have sufficient real evidence for narrower classifications.

Real Fixtures must not contain private keys, access credentials, non-public RPC endpoints, or unnecessary user-identifying information.
