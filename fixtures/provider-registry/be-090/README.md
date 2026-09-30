# Issue #90 — Arbitrum One bounded feasibility

`HISTORICAL_CAPTURE=QUALIFIED`
`INDEPENDENT_REPLAY=BLOCKED`
`PRODUCTION_SUPPORT=NO`

The immutable capture records `ARBITRUM_ONE_FEASIBILITY_QUALIFIED` for one
read-only native ETH → USDC path through Camelot AMMv3 on Arbitrum One.
Independent historical-state replay remains blocked as described below.
`productionSupport=false` and `productAccepted=false` remain unchanged. Capture:
[one-eth-usdc-2026-09-29T14-26-10-520Z/capture.json](one-eth-usdc-2026-09-29T14-26-10-520Z/capture.json).
SHA-256: `da79405cbf55d49d71df568371ba6af222e3d82669e172ea526e867f1560760c`.
Source head: `f4bacf2d509e2b9f9de0365a7ee8ecedd799e609`.

## Target and evidence boundary

[Arbitrum's public documentation](https://docs.arbitrum.io/arbitrum-bridge/quickstart)
identifies chain 42161. [Camelot's Arbitrum One contract list](https://docs.camelot.exchange/contracts/arbitrum/one-mainnet/)
provides the AMMv3 factory, quoter, router, WETH, and USDC deployments. The
historical probe recorded contract code, token metadata, factory discovery of the direct
WETH/USDC pool, pool tokens, active liquidity and token balances at one pinned
block. It obtained a nonzero quote, constructed and decoded an exact unsigned
native-input router transaction, then observed successful pinned `eth_call`
and `eth_estimateGas`. The public third-party EOA's confirmed transaction,
empty account code, and native balance supply read-only sender provenance and
account state. Allowance and spender are `NOT_APPLICABLE` for native input.
The pinned chain and block hash were rechecked. `debug_traceCall` was
unavailable on the public RPC; Trace remains supplementary.

The probe uses the generic Native RPC transport and One-specific, official
deployment facts. It does not run the assembled Sepolia Backend or
`NativeRpcProvider`. No state override, approve, signature, broadcast,
custody, write RPC, private API, or Provider ranking/fallback was used. The
capture contains normalized evidence, an exact transaction, source manifest,
secret scan result, and limitations; no RPC endpoint, key, or raw Provider
payload is retained.

## Capture-source audit matrix

This matrix is bound to source head `f4bacf2d509e2b9f9de0365a7ee8ecedd799e609`
and the capture manifest. It is not a claim that later main revisions retain
every listed file.

| Class | Capture-source state | Consequence for One |
| --- | --- | --- |
| A — chain-agnostic | `native-rpc-client.ts` transports JSON-RPC; `trusted-token-registry.ts` keys by chain; SDK HTTP client and canonical Contract/Risk data shapes do not require the Sepolia route. | Reusable primitives, with explicit chain and provenance inputs. |
| B — config-bound | Runtime token registry, output decimals, and RPC URL have config seams. | Necessary but insufficient for One. |
| C — Sepolia-hardcoded | Runtime config, Camelot adapter and binding, chain adapter, account-state reader, qualified spender, Native Provider, Trace source, and Backend bootstrap bind chain 421614 and Sepolia deployments. | One requires coordinated Backend chain/deployment design; silent chain substitution is invalid. |
| D — Product-specific | Bootstrap P0 metadata and web analyze mapping/fixtures assume the Sepolia ETH/USDC and USDC/WETH paths (plus Monad). | Any eventual One product activation needs separate Product/UI decision; none is made here. |
| E — Provider-specific | Native Provider checks Sepolia chain and exact prepared execution; Trace source is supplementary but Sepolia-bound. | Extend Provider identity checks by chain without weakening binding, fail-closed behavior, or ranking. |

The direct pool and AMMv3 quote/router interface are compatible with this
scenario's ABI. That observation does not make the current composition
config-only. Classification: `BACKEND_ARCH_CHANGE`, `configOnly=false`.
Contract and Risk semantic changes are not indicated by this bounded
scenario. Any promotion should first design a chain-bound deployment registry
and propagate its identity through adapter, transaction binding, account state,
Provider, Trace, and bootstrap. Preserve the existing Sepolia and Monad paths
and seek separate Product acceptance before exposing One in the UI.

## Independent closeout and owner handoff

The fresh main reviewed during closeout is
`35415792c4ca127050f28600d9bb3c2e9ac37bcd`. Its rollback commits removed the
SDK HTTP client and qualified-spender implementation and rolled back parts of
the Frontend/bootstrap paths represented in the historical manifest. The
remaining runtime schema still accepts only chain 421614; the Camelot adapter
and transaction binding retain Sepolia deployments, the chain adapter,
account-state reader, Native Provider and Trace source retain Sepolia identity
checks, and bootstrap and web protocol mapping still select Sepolia. Therefore
`BACKEND_ARCH_CHANGE` / `configOnly=false` remains the current conclusion.
No removed implementation is restored by this research branch.

The immutable capture digest protects the full historical manifest, including
the old probe digest and the subsequently removed Backend/SDK files. A static
Git-blob audit checked all 19 entries against the historical source head. The
capture test preserves that old probe identity and checks the unchanged RPC
transport. The current probe now collects 17 existing source inputs and no
longer depends on the deleted qualified-spender or SDK client files; a separate
test exercises that manifest collector without any RPC request. Other manifest
entries remain historical audit inputs. The probe fix does not rewrite the
capture or claim that its historical source digest matches the current probe.

Independent GPT/Codex review on 2026-09-30 verified the official deployment
addresses, source manifest, complete calldata and transaction fingerprint,
protection floor, and sender balance/gas arithmetic. Live read-only requests
confirmed chain 42161 and the historical block number, hash and timestamp.
Historical state reads then failed: the original public RPC reported historical
state unavailable, the deployment-document public RPC was unreachable, and a
public archive service returned HTTP 403 for historical code. No credentials or
access restrictions were bypassed. Pool/code/token state, quote, router call and
gas therefore remain capture-recorded observations rather than independently
replayed results. Trace unavailability is also capture-recorded.

`INDEPENDENT_REPLAY=BLOCKED` / `BLOCKED_HISTORICAL_STATE_RECHECK`. The capture
bytes and qualification label are preserved as historical evidence;
deterministic tests do not prove independent live execution. This research
closeout records both the preserved historical qualification and the replay
blocker for human review. A legitimate archive reader at block 510054964 is
needed to finish independent replay; no production support is claimed.

Ownership of any separately approved promotion:

- `@jzhao0`: Provider chain/deployment identity, exact prepared-transaction and
  pinned-block provenance, fail-closed capability checks, supplementary Trace.
- `@brightheartma`: runtime/deployment configuration, Camelot adapter and binding,
  chain adapter, account-state/spender design, and Backend bootstrap registration.
- `@antony819`: chain/protocol mapping, token display and decimals, user-facing
  route activation and evidence presentation after the Product decision.
- `@chin0312`: bounded target approval and separate Product acceptance.
- `@rainypilgrimage`: shared Contract review only if a later design changes
  canonical Evidence semantics. No Contract or Risk semantic change is indicated
  by this scenario.

This closeout stays within the four-hour feasibility limit and adds no
production promotion implementation. No Issue status or shared context document
is changed; any eventual research PR requires human review and must not be
self-approved or merged by this task.
