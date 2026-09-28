# Issue #107 Verified Remediation — live feasibility blocker

Status: `NOT COMPLETE` — `BEST CASE / VERIFIED REMEDIATION` has no reachable real
scenario under the current frozen semantics.

Owner of this record: Provider/Risk Evidence qualification (`@jzhao0`), exercising the
merged Backend orchestration owned by `@brightheartma`. This document records evidence and
open questions. It does not change Risk, Product, Contract, or Provider semantics, and it
does not claim the gate.

## Question

Issue #107 asks for at least one real scenario:

```text
initial diagnosis
→ quantified remediation candidate
→ child Run
→ fresh quote
→ exact prepared unsigned tx
→ real Provider evaluation
→ Risk re-evaluation
→ actual VERIFIED result
```

## What is already implemented on `main`

The mechanism is merged, not missing:

- bounded solver and candidate verification boundary — `packages/risk/src/p0-solver.ts`;
- verified-remediation gate inside P0 Risk — `packages/risk/src/p0-diagnosis.ts`
  (`evaluateP0Risk`, `candidateContextBound`, `verificationBound`);
- Backend orchestration, terminal child Runs, public projection —
  `apps/api/src/backend/arbitrum-composition.ts`
  (`evaluateArbitrumP0Decision`, `evaluateArbitrumCandidate`, `persistChildRun`,
  `projectRemediation`);
- public projection contract with `NOT_RUN`, `UNVERIFIED`, `NO_VALID_CANDIDATE`, `UNKNOWN`,
  `VERIFIED` — `packages/contracts/src/p0-run-result.ts`.

`VERIFIED`, and the whole branch that can produce it, is covered today only with a
caller-injected `providerEvidenceMapper` in unit tests
(`apps/api/src/backend/arbitrum-composition.test.ts`). That is synthetic Evidence, not a
real scenario, and it is exactly what #107 forbids presenting as verification.

## What this exercise did

`pnpm --filter @parallax/api probe:verified-remediation` runs three real Arbitrum Sepolia ×
Camelot V3 × ETH → USDC Checks through the production HTTP path, from the accepted BE-063
real quote scenario, with the bounded solver configuration that the accepted P0 Golden Path
exercise intentionally withholds:

| Run | Declared Economic Boundary | Purpose |
| --- | --- | --- |
| A | omitted | read the live quote output for this scenario |
| B | 99% of the live quote output | the primary Run: an executable prepared transaction with the solver configured |
| C | 100.1% of the live quote output | boundary-FAIL probe: the diagnosis a remediation would target |

Recorded capture:
`fixtures/provider-registry/be-107/verified-remediation-<stamp>/capture.json`.

Live result (Run B):

| Fact | Value |
| --- | --- |
| HTTP / Run | `200`, `completed` |
| `eth_call` | `SUCCEEDED` |
| `gasEstimate` | `AVAILABLE` |
| Transaction Protection | `PASS` |
| `providerEvidence.provider.status` | `UNKNOWN` |
| `p0.evidenceState` | `INCOMPLETE` |
| `p0.remediation` | `NOT_RUN` |
| Risk verdict | `UNKNOWN` |
| Feasibility | `NOT_REACHABLE` |

Run C was rejected (`HTTP 502`, `integration_error`) — see blocker 4.

## Blockers

The gate reports six blockers. They are not one sequencing problem; each is independently
sufficient, and they fall into two classes.

### Evidence insufficiency

1. `EVIDENCE_STATE_NOT_VERIFIED` — the remediation branch only runs when the Run's
   provider-neutral `EvidenceState` is `VERIFIED`
   (`apps/api/src/backend/arbitrum-composition.ts:evaluateArbitrumP0Decision`). A live Run
   never reaches it, so no candidate is ever quoted.
2. `LIVE_PROVIDER_STATUS_NOT_SUCCESS` — that state requires
   `GenericEvidence.provider.status === "SUCCESS"`
   (`apps/api/src/backend/p0-risk-integration.ts:backendEvidenceState`), which no merged
   live mapper can truthfully report: a fully successful Native RPC result is deliberately
   mapped to `UNKNOWN` because its surface is partial
   (`apps/api/src/backend/native-rpc-evidence.ts:genericProviderStatus`), and the Tenderly
   mapper keeps `outcome`/`assetChanges` `null` while marking LIVE field provenance
   `external`, which `backendEvidenceState` also rejects
   (`apps/api/src/backend/tenderly-evidence.ts:mapTenderlyProviderResult`). Tenderly
   credentials are not configured for this workspace.
3. `CHILD_SIMULATED_OUTPUT_UNAVAILABLE` — even with a `VERIFIED` state, accepting a
   verified remediation requires the child Run's `P0-ECONOMIC-001` to be `PASS`, which
   requires `simulated_token_out` Evidence derived from `evidence.outcome` or
   `evidence.assetChanges`
   (`apps/api/src/backend/arbitrum-composition.ts:candidateTransactionProtectionOutcome`,
   `packages/orchestrator/agent-flow/index.ts:economicRuleResult`,
   `packages/orchestrator/agent-flow/index.ts:extractSimulatedTokenOut`). No merged provider
   mapper populates those fields. The real state-diff information does exist at the RPC
   level (the qualified supplementary Trace source observes
   `debug_traceCall.prestateTracer.diffMode`, recorded under `be-110`), but no frozen
   Evidence mapping turns a trace state diff into an `outcome` or `assetChanges` record.

### Rule structure

4. `TRANSACTION_PROTECTION_IS_ECONOMIC_BOUNDARY` — a declared Economic Boundary is bound
   verbatim into the prepared calldata as `amountOutMinimum`
   (`apps/api/src/backend/camelot-v3-protocol-adapter.ts:transactionProtection`).
   Therefore `Economic Boundary FAIL` implies a prepared transaction whose floor exceeds the
   quoted output, so the Run terminates as an integration error instead of producing a
   completed `ADJUST` diagnosis. Risk `ADJUST` — the only verdict the frozen remediation
   objective targets — is unreachable on the live Camelot path
   (`packages/risk/src/verdict.ts:evaluateEvidence`).
5. `CONSTRAINT_ROUTE_NOT_SIZE_REMEDIABLE` — the alternative child-verification route needs a
   real measured caller constraint that `FAIL`s at the Run `amountIn` and `PASS`es at a
   larger candidate `amountIn`, because the frozen solver only searches upward
   (`packages/risk/src/p0-solver.ts:solveSelectedTargetOutput`). Every supported constraint
   metric degrades as trade size grows, and `maxTotalCost` has no reviewed derivation at all
   (`packages/risk/src/p0-diagnosis.ts:evaluateConstraints`).
6. `REMEDIATION_BRANCH_NOT_ENTERED` — the observed consequence of blockers 1–2: with a real
   bounded solver configuration the public projection still reports `NOT_RUN`, so the gate
   cannot even reach the `UNVERIFIED` / `NO_VALID_CANDIDATE` states on the live path.

## Result

`VERIFIED_SCENARIO_FOUND = NO`.

The blocker is **evidence insufficiency plus rule structure**, not scenario scarcity: the
route, pool, quote, exact prepared unsigned transaction, live `eth_call`, gas estimate,
pinned block, persistence, and historical read all behaved correctly in this exercise. What
is missing is a provider surface that can truthfully report a complete, non-external,
successful simulation, and a child re-check that can produce `simulated_token_out` Evidence.

## What was deliberately NOT done

Lowering thresholds, mocking a PASS, hardcoding a verdict, overriding state, fabricating
balances/quotes/provider results, promoting `UNKNOWN` to `VERIFIED`, or redefining
`transactionProtection` / `backendEvidenceState` / provider status semantics. Any of those
would falsify the gate rather than pass it.

## Open decisions (not this PR's authority)

1. **Provider qualification** — qualify a live provider surface that can report a complete
   successful simulation with non-`external` provenance (Owner: Provider/Risk).
2. **Trace-to-Evidence mapping** — decide whether a qualified `prestateTracer` state diff may
   become canonical `outcome` / `assetChanges` Evidence (Owners: Contract, Provider/Risk,
   Product).
3. **Transaction Protection vs Economic Boundary** — decide how a declared expectation can
   produce a non-executable `FAIL` diagnosis without being encoded as the calldata floor
   (Owners: Product, Contract, Backend).
4. **Bidirectional solving** — decide whether the frozen objective also needs a
   size-reducing search before constraint-based remediation can be satisfied
   (Owners: Product, Backend, Provider/Risk).

Until at least one of these is accepted and merged, #107 remains open and this gate stays
`VERIFIED_REMEDIATION_NOT_REACHABLE`.

## Reproduction

```bash
git checkout feat/verified-remediation-107
pnpm install --frozen-lockfile
pnpm --filter @parallax/api probe:verified-remediation
```

The runner refuses to run when production runtime source is dirty, records the exact source
head, the accepted fixture digest, the runner digest, and writes a sanitized capture with no
RPC endpoint, no raw Provider payload, and no transaction bytes.

## Boundaries preserved

- read-only: no signing, broadcasting, custody, or wallet mutation occurred;
- no canonical Evidence, Verdict, Risk rule, or public Contract semantics changed;
- `UNKNOWN` remains `UNKNOWN`; a proposed, failed, or unknown candidate is never reported as
  verified;
- provider raw payloads stay isolated; the capture is provider-neutral.
