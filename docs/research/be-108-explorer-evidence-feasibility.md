# BE-108 Explorer Evidence feasibility (#108)

Status: **PARTIAL keyless historical/descriptive feasibility evidence; no production integration.**

```text
CREDENTIALED_ETHERSCAN_V2=BLOCKED_MISSING_API_KEY
HISTORICAL_DURATION=UNVERIFIABLE
PRODUCTION_SUPPORT=NO
PRODUCTION_INTEGRATION=NOT_STARTED
```

The two-hour limit is the prescribed research budget, not a verified historical duration.
This Provider-only closeout retains the original capture and research runner, withdraws the
unintegrated Backend prototype to non-executable historical attachments, and stops further
Etherscan V2 research. No Final Sprint gate depends on this work. Native RPC remains primary.
No Provider registration, ranking, voting, fallback, signing, broadcasting or custody is added;
frozen Product/Risk/Contract semantics are unchanged. Final acceptance and docs CODEOWNERS
review remain separate from this local implementation and its static checks.

## Historical surfaces and access

All observations below are from the immutable 2026-09-28 capture, not new network requests.
Resource paths are associated through the original runner whose bytes and hash are archived.

| Surface | Retained evidence | Boundary |
| --- | --- | --- |
| Etherscan V2 `/v2/api` | One no-key request for chain `421614`: HTTP 200, status `0`, `NOTOK`, `Missing/Invalid API Key` | Authentication failure only. Empty-key and placeholder-key V2 cases are not retained; no credentialed qualification |
| Etherscan `/v2/chainlist` | Keyless HTTP 200, totalcount 63; chains `42161` and `421614` listed with status 1 | Chain listing only; free-key entitlement remains UNKNOWN |
| Legacy Arbiscan `/api` | Deprecation response | Original runner used a public placeholder on this legacy request, not additional V2 credential cases |
| Blockscout Sepolia `/api` | Eight capability requests returned HTTP 429; limit `10`, remaining `0` | BLOCKED by rate limiting; not evidence that any module is unsupported |
| Blockscout Sepolia `/api/v2` | Seven resource requests returned HTTP 200; limit `180` | REST observations only; ABI had no independent request and no complete receipt was captured |

The original capture records no credentialed Etherscan V2 request. Its documentation snapshot
contains historical plan limits (Free 3/s and 100,000/day on selected chains; higher paid tiers)
and a PRO `tokeninfo` restriction. Those are DOCUMENTED statements, not observed entitlement,
throughput or current plan qualification. The API auth observation concerns `/v2/api`;
keyless chainlist is a separate resource. No credential store is inspected for this closeout.

The recorded headers and 429 responses do not establish the cause of budget exhaustion, a reset
interval, or a measured ~45-second pacing window. No such duration is retained. Only the headers
and statuses are claimed here. `Unknown module` and `chain not supported` are not retained live
failures in this capture; their appearances in original unit tests are MOCK cases.

## Capability verification matrix

DOCUMENTED means a research request template or documentation statement, not endpoint qualification.
OBSERVED means retained response fields on the named surface. PARTIAL limits an observation's scope.
BLOCKED identifies recorded access failure. UNVERIFIED identifies a fact or coverage claim not established.
None of these research labels grants production support, execution Evidence or a Risk PASS.

`M[i]` below denotes `capabilityMatrix[i]` in the original capture.

| Capability | Status | Actual source and retained facts | Unverified scope |
| --- | --- | --- | --- |
| Contract verification | OBSERVED | M[0].liveRestSurface: HTTP 200 contract resource, `isVerified="true"`, Solidity, compiler `v0.7.6+commit.7338295f`, verification timestamp | Independent source-code verification; historical state binding |
| ABI | PARTIAL | M[0].liveRestSurface.facts.abiEntries = 21, from the contract resource | M[1].normalizedFacts.abiFingerprint and abiEntryCount are null; no dedicated ABI request or retained ABI body |
| Creator / deployment | OBSERVED | M[2].liveRestSurface: HTTP 200 address resource, creator `0x864b…14e1`, creation transaction `0x04c3…867d` | Independent on-chain deployment verification |
| Token metadata | OBSERVED | M[3].liveRestSurface: HTTP 200 token resource, USDC Sepolia / USDC / 18 / ERC-20 | Credentialed V2 tokeninfo, PRO entitlement and state-at-target-block qualification |
| Historical transaction | OBSERVED | M[4].liveRestSurface: target tx `0xb116…644a`, block 310131879, status ok, result success, gasUsed 384021 | Current execution-time simulation or qualification |
| Receipt | PARTIAL | Transaction status/gas and log count from M[4] and M[6] only: receipt-equivalent fields | M[5] has no dedicated REST receipt; compatible request returned 429. Complete receipt and receipt-status normalization UNVERIFIED |
| Logs | OBSERVED | M[6].liveRestSurface: target transaction log resource returned 4 items and first topic `0xddf252ad…` (ERC-20 Transfer) | Complete block-wide logs, complete pagination and per-item block binding |
| Token Transfers | PARTIAL | M[7].liveRestSurface: one address-resource request returned 50 items | Complete pagination, full history range, reaching target block and per-item target-transaction binding UNVERIFIED |
| Explorer provenance | OBSERVED | M[8].liveRestSurface: HTTP 200 block resource, height 310131879 and hash `0x715bfaca…60feff` match the target | Independent network replay; binding every other resource to that block |

All credentialed Etherscan V2 capabilities remain BLOCKED_MISSING_API_KEY. Blockscout REST
observations cannot be relabeled as qualified V2 module/action responses. The compatibility
request templates are historical research descriptors; in particular `getToken` is not a
qualified Etherscan V2 `tokeninfo` request.

A response SHA256 identifies a historical response body, not an independent ABI fingerprint.
The ABI body was not retained, so its fingerprint cannot be reconstructed from the count 21.
The capture also contains null compatible normalized fields and `verified=false` from the
rate-limited compatible path alongside successful REST facts. These different response paths
must not be merged into a claim that REST proved the contract unverified.

### Token Transfer range and completeness

Three distinct facts must remain separate:

- Original Runner compatible request: `startblock=0`, `endblock=99999999`, `sort=asc`;
  no explicit page/offset. The request was rate-limited. Its upper bound is below target
  block `310131879`, so that range does not reach the target.
- Original Backend prototype template: the same block range, `sort=desc`, `page=1`, `offset=100`.
  It is archived code, not proof that a live complete scan occurred.
- Successful REST observation: one address resource response reported 50 items. The capture
  retains no per-item tx/block/token fields or next-page cursor. Pagination exhaustion,
  the covered range and reaching the target block are UNVERIFIED. It may be incomplete;
  the evidence does not prove either completeness or that a next page existed.

### Explorer provenance

The original Runner made a REST block request and retained HTTP status, response SHA256,
height/hash/timestamp. The identity matches the accepted historical evidence at
`fixtures/provider-registry/be-063/camelot-sepolia-real-2026-09-18T08-47-56-715Z/capture.json`
(`observations.pinnedBlock.hash` and `observations.preparedSwap.senderTransactionHash`).
This is a secondary static audit of historical records, not an independent on-chain replay.
Without raw bodies the response fingerprints cannot be recomputed or independently authenticated.
Contract/token/address resources are descriptive resources, not proof of their state at the pinned block.
Simulation, trace and state-diff are excluded from this research; no universal claim about all
Explorer products is made.

## Historical source protection

Capture (unchanged):
`fixtures/provider-registry/be-108/explorer-feasibility-2026-09-28T13-42-15-552Z/capture.json`

```text
Capture SHA256: 58c6118145b9df36de039ac9cfadaf401d72aded745a68ea094e06a199ccbf70
Original Runner SHA256: da94430818626e02fc5e9ae7838578fa15d01712239a15451348267b5a587f17
Historical manifest SHA256: 9d6ea554296fffff6c5dc570e95cf5ae921989e1c3dc46825527026300c02b17
Recorded capture HEAD: f8cc7beb4f899e0b8283e1e30a67814a4989c73e
Recoverable source commit: 9d992d9533dc035d9fe6becc4abcc44f089e6400
worktreeDirty=true
```

The 59 manifest entries match Git blobs at the recoverable source commit. Of these, 58 match
the recorded capture HEAD; `apps/api/src/backend/explorer-evidence-source.ts` was then dirty
worktree content absent from that base commit. The later commit preserves the bytes but was
not the capture-time HEAD. The capture must never be relabeled as coming from a clean HEAD.

`fixtures/provider-registry/be-108/historical-source-9d992d9/manifest.json` records original
paths, source commit, Git blob IDs, SHA256, sizes, purposes and limits for byte-identical
`.ts.txt` attachments of the original Runner, Backend prototype and MOCK tests. The original
Runner hash is separate from the 59-file manifest. These attachments are not executable code,
are not imported and are not current implementation tests.

HISTORICAL_SOURCE_VERIFICATION verifies frozen capture/manifest/archived bytes and Git object
identity. Local full-manifest auditing uses the fixed historical commit, never the post-removal
current tree. Portable tests compute archive Git blob IDs without fetching historical objects.
CURRENT_IMPLEMENTATION_VERIFICATION separately checks the refactored Runner, pure Probe
module and corrected evidence interpretation. A passing current test does not replace or
qualify the original historical Runner. Neither test suite establishes live network qualification.

## Withdrawn prototype and Clare's findings

The unintegrated Backend prototype and its test are preserved as historical attachments and
withdrawn from the application directory with Owner-authorized disposition. Archival does not
repair their internal defects or grant production qualification:

1. Prototype `provenance()` makes no Explorer request, copies caller block context and even
   reports checked/live_verified with missing context. It is not valid observed provenance.
   The retained Runner's block observation is separate; current interpretation requires a
   successful block response with matching height/hash and fails closed on missing/mismatched data.
2. Fixed etherscan-compatible-v2 and static live_verified labels overstate surface qualification.
   Current Probe templates grant no qualification; each interpreted observation names its actual
   surface and keeps V2 blocked. Original capture labels remain immutable historical assertions.
3. Receipt normalization incorrectly treats any non-empty non-0x1 status as reverted. That
   normalizer is not migrated. Current research retains receipt-equivalent fields only and makes
   no normalized execution-status or complete-receipt claim.
4. Prototype transfers use an insufficient range and one page. That implementation is not
   migrated; the limited historical REST count and missing completeness are disclosed above.
5. The historical timing gap is retained as HISTORICAL_DURATION=UNVERIFIABLE, not backfilled.

MOCK normalization/classifier tests do not prove LIVE qualification. Withdrawal resolves the
prototype's disposition, not review acceptance of these evidence gaps. Clare's final evidence
review and applicable docs CODEOWNERS review are still required before merge.

## Research duration and closeout boundary

No reliable `startedAt`, `finishedAt` or `elapsedMs` is present in the historical capture.
`capturedAt=2026-09-28T13:42:15.552Z` is the retained record timestamp; the original Runner assigned
it before the request sequence. It does not independently establish research start, finish or
elapsed duration. Request helper timings were not persisted. Git commit times, file timestamps,
chain block time and contract verification time cannot fill that gap. No claim is made that the
budget was met or exceeded. No future timing record can retroactively qualify this history.

No new network probe, API Key acquisition or credentialed V2 research is part of this closeout.
The retained Runner is not authorization to rerun research; no future timing feature is added here.
Missing API Key remains an explicit credentialed-qualification blocker, not a request to continue.
Production integration remains NOT_STARTED and would require separately approved Backend scope.
No Product P0, Asset Coverage, Evidence Federation core or Verified Remediation gate depends on #108.
