# BE-108 Explorer Evidence feasibility (#108)

Status: **bounded two-hour feasibility probe complete; credentialed Etherscan V2 / Arbiscan
qualification BLOCKED (no API key); no production integration started.**

Scope: can an explorer API be a truthful *supplementary* Evidence source for contract verification,
ABI, creator/deployment, token metadata, historical transaction, receipt, logs, token transfers, and
explorer provenance — and explicitly **not** a simulation, trace, or state-diff provider?

This document records the answer and its evidence boundary. It does not add a Provider, change frozen
Product/Risk/Contract semantics, or claim runtime support for any surface that was not exercised.

## What was probed

| Surface | Role | Keyless | Observed |
| --- | --- | --- | --- |
| `https://api.etherscan.io/v2/api` | credential-gated Arbiscan / Etherscan V2 API | no | `{"status":"0","message":"NOTOK","result":"Missing/Invalid API Key"}` for `chainid=421614` with no, empty, and placeholder keys |
| `https://api.etherscan.io/v2/chainlist` | chain support | yes | HTTP 200, `totalcount` 63 |
| `https://api.arbiscan.io/api` | legacy Arbiscan V1 | no | `"You are using a deprecated V1 endpoint, switch to Etherscan API V2"` |
| `https://arbitrum-sepolia.blockscout.com/api` | live Etherscan-compatible surface on the same chain | yes | `x-ratelimit-limit: 10`; HTTP 429 for every capability call in the recorded run |
| `https://arbitrum-sepolia.blockscout.com/api/v2` | live explorer REST surface on the same chain | yes | HTTP 200 for every capability call in the recorded run |

Targets were existing repository evidence: the Camelot V3 router `0x171B…FD93`, WETH
`0x980B…7c73`, test USDC `0xb893…9FC7`, the Camelot V3 pool `0x3965…0e2d`, the accepted historical
transaction `0xb116…644a`, and the accepted pinned block `310131879` / `0x715bfaca…60feff`.

## Findings

### Authentication

Every Etherscan V2 request requires an API key — documented ("Every request to the Etherscan API needs
an API key") and observed directly. Arbiscan has no separate API anymore: `arbiscan.io` /
`sepolia.arbiscan.io` are the explorers behind `api.etherscan.io/v2/api?chainid=42161` and
`?chainid=421614`. The legacy V1 host answers with a deprecation message.

This workspace holds no `ARBISCAN_API_KEY` / `ETHERSCAN_API_KEY`, so the credentialed surface could
not be exercised. No credential was invented, logged, or committed.

### Rate limits

Documented plan table (docs.etherscan.io/rate-limits): Free 3 calls/s, 100,000/day, **selected chains
only**, no PRO endpoints; Lite 5/s; Standard 10/s + PRO; Advanced 20/s; Professional and Pro Plus 30/s;
Dedicated custom. `tokeninfo` is a PRO endpoint (Standard and above) throttled to 2 calls/s.

Observed on the keyless surfaces: the Etherscan-compatible `/api` surface advertises
`x-ratelimit-limit: 10` and answers HTTP 429 `Too many requests` once that budget is spent (the budget
did not reset within a ~45-second pacing window, and the recorded run was entirely rate-limited); the
REST `/api/v2` surface advertises `x-ratelimit-limit: 180`.

### Chain support

`https://api.etherscan.io/v2/chainlist` (keyless) lists both target chains with status 1 (Ok):
Arbitrum One `42161` → `https://arbiscan.io/`; Arbitrum Sepolia `421614` → `https://sepolia.arbiscan.io/`.
The documented free plan covers "selected chains only", so whether `421614` is included on a free key
remains **UNKNOWN** until a key holder verifies it.

### Capability answer

| Capability | Explorer answer | Basis |
| --- | --- | --- |
| contract verification | yes | live: `is_verified=true`, `language=solidity`, `compiler_version=v0.7.6+commit.7338295f`, `verified_at` |
| ABI | yes | live: 21 ABI entries for the router, fingerprinted |
| creator / deployment | yes | live: creator `0x864b…14e1`, creation transaction `0x04c3…867d` |
| token metadata | yes, with a plan caveat | live: `USDC Sepolia` / `USDC` / `18` / `ERC-20`. Etherscan V2 serves this through the **PRO** `tokeninfo` endpoint, so a free key may not provide it |
| historical transaction | yes | live: accepted transaction, block `310131879`, `status=ok`, `result=success`, `gas_used=384021` |
| receipt | partial | receipt-equivalent fields (`status`, `gas_used`, log count) were observed from the transaction and log resources; the dedicated `proxy` module form was not served by the keyless surface |
| logs | yes | live: 4 logs at the accepted pinned block, first topic `0xddf252ad…` (ERC-20 `Transfer`) |
| token transfers | yes | live: 50 transfers for the accepted sender |
| explorer provenance | yes | live: the explorer REST block resource reproduced the accepted pinned block hash `0x715bfaca…60feff` |
| simulation / trace / state diff | **no** | no explorer endpoint executes a transaction, traces a call, or diffs state; these are excluded from the source surface entirely |

## Prototype

`apps/api/src/backend/explorer-evidence-source.ts` is a minimal, provider-neutral prototype:
capability-scoped result, injected transport (endpoint and key stay outside), fail-closed
`checked` / `unknown` / `unavailable` observations with bounded reasons, and an explicit
`simulation` / `trace` / `state-diff` exclusion list. It adds no ranking, voting, scoring, consensus,
preference, or automatic fallback, and it is not a substitute for the primary Native RPC baseline.

Each capability carries a verification marker so documented availability can never be mistaken for
qualification: `live_verified` (shape observed live, with the surface recorded) or
`documented_unverified` (documented for Etherscan V2 only). `receipt` is `documented_unverified`.

Real failure envelopes observed during the probe (`Unknown module`, `Too many requests`,
`Missing/Invalid API Key`, `chain not supported`, deprecated-V1 text) drive the classifier, so a
capability that cannot be observed stays `unknown` instead of being inferred.

## Evidence

- Capture: `fixtures/provider-registry/be-108/explorer-feasibility-2026-09-28T13-42-15-552Z/capture.json`
- Runner: `scripts/provider-probes/explorer-evidence-feasibility.ts`

The capture stores normalized facts, response fingerprints, HTTP status, and observed rate-limit
headers only: no raw provider payload, no source-code or ABI body, no endpoint credential.

## Blocker and next steps

**TRUE BLOCKER:** credentialed Etherscan V2 / Arbiscan qualification needs an explorer API key that
this workspace does not hold. Recommended next steps, none of which are production integration:

1. a key holder runs the same runner against `api.etherscan.io/v2/api?chainid=421614` to confirm the
   free-plan chain availability question and the `proxy`/`logs`/`account` module shapes;
2. if the explorer path is later approved, the Backend (`@brightheartma`) decides whether an explorer
   source is worth composing at all, given that Native RPC remains primary and #91/#106 already cover
   execution-time Evidence;
3. no Product P0, Asset Coverage, Evidence Federation core, or Verified Remediation gate depends on
   this work.
