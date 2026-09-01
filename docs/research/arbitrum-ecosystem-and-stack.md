# Parallax × Arbitrum：生态与技术栈研究

> 研究/策略参考，不是已部署能力的声明。
>
> 最后复核：2026-09-02；Arbitrum 动态统计证据日期：2026-08-29。提交前必须重新核验数字与网络支持。

## Why Arbitrum

Arbitrum 的价值不只是低成本 EVM。官方资料将其描述为 programmable economy/finance 平台，生态覆盖 DEX、Lending、Derivatives、RWA、Payments、Institutional 与 Agentic Finance：[Arbitrum Finance](https://arbitrum.io/solutions/finance) · [Programmable Economy](https://blog.arbitrum.io/architecture-of-the-programmable-economy/)。

官方 H1 2026 摘要报告 1,142 live projects、10.5M stablecoin holders、月度 stablecoin transfer volume 超过 $60B、约 $850M RWA AUM 等数字；这些数字随时间变化，不应脱离证据日期写成永久事实：[H1 2026 summary](https://blog.arbitrum.foundation/arbitrum-h1-2026-the-programmable-economy-is-accelerating/)。

活动越丰富，用户/Agent 面对的 Chain、Protocol、Route、Quote、Simulation、Provider、price impact 和 scope 信息越碎片化。Arbitrum 提供 execution infrastructure，Parallax 的研究假设是提供可组合的 pre-execution judgment。

## Why Parallax

一笔 Swap 可以可执行、没有恶意信号，却不满足用户明确的 economic boundary：

```text
Intent
→ Evidence
→ Cause
→ PROCEED / ADJUST / STOP / UNKNOWN
→ Relevant Action
→ Re-verification
```

Parallax 不替代 DEX、Simulator、Wallet 或 Security Layer；它把这些来源的 Evidence 组织成可解释、范围受限的 Decision，并验证调整是否真的改变了结果。`UNKNOWN` 不是通过，`PROCEED` 不是安全保证。

## Protocol 选择：Camelot first，Uniswap fallback

Camelot 是 Arbitrum-native liquidity hub，官方文档提供 Arbitrum Sepolia 的 V2/V3 contracts、Quoter、SwapRouter、WETH 与 USDC：[Camelot docs](https://docs.camelot.exchange/) · [Sepolia contracts](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/)。其 V3 的 concentrated liquidity、dynamic/directional fees 和 price impact 使“可执行但不符合用户意图”的场景适合做 P0 feasibility。

Camelot V3 基于 Algebra，Adapter 不能照抄 vanilla Uniswap V3；Aggregator mode 还可能组合多来源，因此 P0 应先固定 native Camelot path。Uniswap 作为标准化、文档丰富的 fallback，叙事上不如 Camelot 能说明“Why Arbitrum”。

GMX、Aave、Pendle 等是未来金融 primitive 方向，不应在当前 Swap-only P0 中同时引入 perps、lending 或 liquidation 语义。

## Evidence Provider 选择

| 阶段 | 组合 | 证据边界 |
| --- | --- | --- |
| 当前 verified | Monad × Kuru × Moss | 以 `main` 上的 Moss/Kuru runtime 与 fixtures 为准 |
| P0 目标 | Arbitrum Sepolia × Camelot V3 × TenderlyProvider | Tenderly 文档支持；credentialed probe 未完成时保持 `SUPPORTED_DOC_ONLY` |
| P0 fallback | NativeRpcProvider | `eth_call`/`estimateGas`/state 等可验证范围；能力不足返回 `UNKNOWN` |
| Strong/Best 可选 | EnsoProvider | 需验证实际 network/protocol/route、API key、provenance 与 freshness |

Tenderly 的 Arbitrum support、simulation、trace、gas、asset changes 与 block provenance 以官方文档为依据；PR #42 当前记录的是文档 feasibility，没有 credentialed request。Native RPC 与 Enso 同样不能只凭文档升级为 verified。

## 两类 portability proof

### Evidence Provider portability

固定同一笔 transaction、Chain、Protocol、calldata 和 value，只替换 Tenderly 与 Native RPC，比较 Evidence、capabilities、provenance、freshness 和状态语义。

### Execution-stack portability

固定同一个用户 Intent，允许 Camelot/Tenderly 与 Enso 产生不同 transaction、route、calldata，比较 quote、economic constraints、Decision 和 re-verification。两者不是一个 Provider 评分测试。

## Arbitrum 路线与限制

目标组合是：

```text
Arbitrum Sepolia
× Camelot V3
× TenderlyProvider
↘ NativeRpcProvider fallback
↘ optional DecisionReceiptRegistry anchor
```

`DecisionReceiptRegistry` 只承诺 Receipt commitment/metadata 的可验证锚定；backend attestor 的签名与用户 Swap 分离，anchoring 必须 optional/non-blocking。最终 Contract 字段、事件、权限、批量/Merkle 策略仍未决。

Arbitrum Chain、Camelot Adapter、Tenderly/Native RPC runtime、Receipt deployment 和真实 P0 E2E 都是计划/开放工作，不得从研究文件写成已部署。当前实现状态请看 [planning index](../planning/arbitrum-open-house/README.md) 和开放 PR [#41](https://github.com/parallax-monad/parallax/pull/41)、[#42](https://github.com/parallax-monad/parallax/pull/42)、[#43](https://github.com/parallax-monad/parallax/pull/43)。

## 参考资料

- [Arbitrum Finance](https://arbitrum.io/solutions/finance)
- [Arbitrum H1 2026](https://blog.arbitrum.foundation/arbitrum-h1-2026-the-programmable-economy-is-accelerating/)
- [Camelot Overview](https://docs.camelot.exchange/)
- [Camelot Sepolia contracts](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/)
- [Tenderly Arbitrum support](https://tenderly.co/blog/changelog/tenderly-node-arbitrum-support/)
- [Tenderly Arbitrum Sepolia](https://tenderly.co/blog/changelog/node-new-testnets/)
- [Enso supported networks](https://docs.enso.build/pages/build/reference/supported-networks)
- [HackQuest Open House](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
