# Basic simulation Risk policy

Status: local implementation of the user's 2026-10-03 decision to narrow the
acceptance scope for the demonstration. Policy ID: `BASIC-SIMULATION-001`.

For Arbitrum Sepolia / Camelot V3, an unconstrained live swap may return
`PROCEED` when its exact prepared transaction passes a pinned contract call,
gas estimation, transaction binding, and block-hash revalidation. This is a
change to the previous policy that required complete simulation evidence.
The policy is applied by the production Arbitrum composition only.

The existing full-evidence rule observations remain visible. `PROCEED` under
this policy does not assert complete simulation or verified economic output:
`provider.status=UNKNOWN`, `p0.evidenceState=INCOMPLETE`, missing receipt,
outcome and asset changes, and `remediation=NOT_RUN` remain unchanged. The
summary identifies the basic policy and its limits. A pinned historical block
is the observation scope; unchecked head freshness remains disclosed.

An explicit minimum received, declared constraints, input-increase consent,
failed rule, failed evidence, stale provider, partial execution, unverifiable
transaction/block, replay or mock does not qualify. Existing STOP and
integration-error results are preserved. The policy does not supply evidence
for #107 child verification or VERIFIED remediation.

## Frontend request

The existing frontend can consume `verdict`; no additional field is required.
For this basic scope leave minimum received blank and do not request an
input-increase/remediation authorization.

```json
{
  "chainId": 421614,
  "protocol": "camelot-v3",
  "sender": "0xeb7c5322f0997ee70f4bbd3ae7e428072c9af396",
  "tokenIn": { "kind": "native" },
  "tokenOut": {
    "kind": "erc20",
    "address": "0xb893E3334D4Bd6C5ba8277Fd559e99Ed683A9FC7"
  },
  "amountIn": "0.001",
  "economicBoundary": { "availability": "unavailable", "source": "unavailable" }
}
```

This sender is an observed read-only test address, not a supplied wallet or
private key. Future calls depend on current balances and chain state.

## Local validation

Docker live QuickNode check on 2026-10-03 at 11:08:05 UTC:

- Run `e1b29eba-b95e-4586-98b1-b7874515cb7b`: HTTP 200, `PROCEED`.
- Block `315308230`; call `SUCCEEDED`, gas `269970`, validity `VALID`.
- Evidence `INCOMPLETE`, remediation `NOT_RUN`; saved GET matched POST.
- This used the configured QuickNode endpoint as `ARBITRUM_RPC_URL` inside the
  test process. Local `.env` and deployment settings were not rewritten.
- The live observation covers the local uncommitted policy, not deployed or
  merged code. No signing, broadcasting or state overrides were used.

The targeted composition suite also checks partial gas failure, binding
mismatch, stale/replayed evidence, missing quote provenance and explicit
economic-boundary rejection. Full simulation/asset-change coverage remains
outside this basic policy.
