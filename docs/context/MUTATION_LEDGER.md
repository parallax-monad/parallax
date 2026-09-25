# Mutation / Incident Ledger

## 2026-09-19 — #69 Git identity attribution incident

Old commits:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` — merge main into #69;
- `503545b2a8c4e72596665a0840340a89578233af` — Provider mode/provenance + failure-text fix;
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` — merge updated main into #69.

Root cause: repo-local Git config `jie <jie@users.noreply.github.com>` overrode the actual operator identity, and GitHub mapped that noreply address to existing account `@jie`.

Integrity review:

- first merge delta exactly matched contemporaneous #79 main delta;
- second merge delta exactly matched contemporaneous #76/#77 main delta;
- no extra conflict-resolution delta;
- Provider fix matched intended #69 scope.

Repair rebuilt the same trees/messages/timestamps/topology with corrected author/committer:

- `9be5e8190f25516c46f2bf0713766d2e95cfa9eb` → `72b683fad84282c8fab165130adcad7b8df58e04`
- `503545b2a8c4e72596665a0840340a89578233af` → `4f5c0f3091ecb495a62f7d440bad992325a81d4e`
- `8e1f28bec2f10f3b8134c85498cc74f534d00748` → `8d97e7536110a10955a48e5825988f96ec15c08f`

Remote update used exact `--force-with-lease` against `8e1f28bec2f10f3b8134c85498cc74f534d00748`.

## 2026-09-19 — project control plane

Added durable takeover/context recovery files and local identity preflight. Feature development remains paused until the repaired #69 head and this control change are validated.

## 2026-09-19 — proportional gating supersedes blanket development freeze

Policy update, appended. The earlier "Feature development remains paused" note is retained
unchanged above as the historical state at the time it was written.

- The blanket development freeze is superseded by proportional gating (`AGENTS.md`,
  `RUNBOOK.md`): gate depth is keyed to risk, reversibility, and semantic reach, not to the
  number of unrelated open PRs or reviewers.
- Routine, scoped, low-risk, reversible work in an already-clear owner boundary may proceed
  after preflight, following `preflight → implement → validate → normal push → scoped review
  if needed`.
- Hard-stop categories that still require an explicit owner/gate decision: Product/Contract
  semantic changes, architecture-wide changes, history rewrite / force push, destructive Git
  operations, security/secrets incidents, signing/broadcasting/custody/wallet mutation, owner
  authority conflicts, accepted-evidence rewrite or meaning change, large cross-owner public
  API changes, and uncertain frozen-boundary impact.
- #82 no longer blocks routine #69/#81 development or review fixes.

The #69 identity-attribution incident history above is unchanged.

## 2026-09-20 — post-#81 takeover state sync

Fresh GitHub state confirmed that #69, #76, #77, #80, #81, and #82 are merged into
`main = bd98013dc956bfa4ff15ff95959f6cb614bf8c9b`. The remaining P0 work is recorded as
#78 final Backend convergence (canonical NativeRpcProvider exercise, minimum public P0
projection, and independent assembled Golden Path evidence) in parallel with #73 Frontend
integration. No Product semantics from #67/#70 were changed.

## 2026-09-20 — checkpoint ancestry semantics correction

Stale equality semantics identified: `PROJECT_STATE.md`, `AGENT_HANDOFF.md`, and
`CONTEXT_RECOVERY.md` recorded the main checkpoint as `main = <sha>` and instructed a fresh fetch
to confirm current `main` equalled that value, and #81's historical PR head was described as a
merged main head.

Wording corrected to checkpoint ancestry semantics: a recorded `checkpoint_head` is the
known-good main tip at checkpoint time, not a claim about current main. Takeover validates after a
fresh fetch that `checkpoint_head` is an ancestor of current main; equality is neither required
nor expected, and non-ancestry means history divergence/rewrite requiring explicit reconciliation
before `TAKEOVER_READY=YES`. This ancestry rule applies to main checkpoints only. #81 is now
recorded with its squash merge/main commit `bd98013dc956bfa4ff15ff95959f6cb614bf8c9b` and its
historical PR head `8700726cc43b9e61b8c3f47558211c2a4c07185d` explicitly labeled as non-ancestral.

No runtime, preflight, Product, Contract, Provider, Backend, Risk, or Frontend behavior changed;
`scripts/agent-preflight.sh` was not modified.

## 2026-09-22 — BE-078 assembled Backend Golden Path exercise

Added the scoped BE-078 live evidence runner and regression assertions. The runner is bound to
the exact local `origin/main` head, uses the accepted BE-063 baseline, starts the injected
production Arbitrum composition, and performs a real read-only Backend API check plus persisted
Run query. It records request/baseline identity, a verified live Provider handoff,
expectation-only baseline binding, public redaction, persistence round-trip, and a hashed
Backend/runtime source manifest without storing RPC credentials or raw provider payloads.

Final capture:

- `fixtures/provider-registry/be-078/backend-golden-path-20260922032144325/capture.json`
- repository head: `1fe17e0bc1292b2a64b196f2dd5182acd17f9145`
- run result: assembled exercise complete and review-required;
  `evidenceState=INCOMPLETE`, `quoteFidelity=UNKNOWN`, `verdict=UNKNOWN`, and
  `expectedFailClosedUnknown=true`;
- source manifest: 102 runtime files, unchanged during execution;
- remediation was intentionally not configured by this exercise and was observed as
  `NOT_RUN`; this is not a solver failure.

No Product/Risk/Contract semantics, Provider implementation, signing, broadcasting, or custody
behavior changed. The capture does not by itself close #78 or constitute final Product Gate
approval; owner review remains required.

## 2026-09-25 — PR #98 QuickNode capability evidence merge

PR #98 was squash-merged into main at `dfee93dc5271b38fa89a2e032bd4f8a97a9719ee`.
It adds real, unsigned/read-only QuickNode Arbitrum Sepolia canonical capability evidence for
the accepted BE-063 Camelot V3 transaction on Node `v22.23.2`. Existing NativeRpcProvider
canonical checks passed; `debug_traceCall` observed `callTracer` and `prestateTracer` diff mode.
The P1 JSON-RPC response-envelope finding was fixed before merge by routing the chain, block,
and both trace requests through the existing fail-closed `createNativeRpcClient()`. CI was green;
Antony819 and brightheartma approved, with brightheartma's approval after the P1 fix.

Final accepted current capture:

- `fixtures/provider-registry/be-078/quicknode-canonical-2026-09-25T03-40-05-885Z/capture.json`.

The earlier `quicknode-canonical-2026-09-24T14-28-41-070Z/capture.json` remains only as
pre-fix historical/superseded evidence. Classification remains
`ALTERNATIVE_ENDPOINT_CAPABILITY_EVIDENCE`. Tenderly #72 qualification and production Provider
selection/wiring are unchanged. #98 neither replaces Tenderly nor completes #72 or #78;
it does not establish full Moss/Tenderly compatibility or validate `callTracer.withLog` or
`stateOverrides`. No Product/Contract semantic or Provider-selection decision changed, and
there was no signing, broadcasting, or custody.
