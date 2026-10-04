# Parallax × Arbitrum：生态与技术栈研究

> 研究/策略参考，不是已部署能力的声明。
>
> 最后复核：2026-09-02；Arbitrum 动态统计证据日期：2026-08-29。提交前必须重新核验数字与网络支持。
>
> **历史选择与计划快照：** 本文的 Provider 顺序、P0 target 和 feasibility 状态反映 2026 年 9 月的研究阶段。当前公开集成是 Arbitrum Sepolia × Camelot V3，Native RPC 为主要执行证据路径、Trace 为补充证据；请勿将下文的旧状态视为当前交付事实。

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
| 研究时的已验证基线 | Monad × Kuru × Moss | 历史兼容路径与 fixtures；不代表当前公开产品支持 |
| 当时的 P0 目标 | Arbitrum Sepolia × Camelot V3 × TenderlyProvider | 历史计划；当前 Native RPC 路径已实现，Tenderly qualification 另见 live status |
| 当时的 P0 fallback | NativeRpcProvider | 已成为当前主要执行证据路径；能力不足仍须如实表达 `UNKNOWN` |
| 当时的 Strong/Best 选项 | EnsoProvider | 历史可选研究方向，不是当前集成声明 |

Tenderly 的 Arbitrum support、simulation、trace、gas、asset changes 与 block provenance 以官方文档为依据；在没有 credentialed probe 前仍只能作为 feasibility 依据。Native RPC 与 Enso 同样不能只凭文档升级为 verified。

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

本节记录的 Arbitrum Chain、Camelot Adapter、Provider runtime、Registry 和真实 P0 E2E 状态已过时，不应从本研究文件推断当前交付情况。当前事实请看 [公开产品概览](../../README.md)、对应的 API/Contract 文档及合并代码；本 planning index 仅作历史参考。

## 参考资料

- [Arbitrum Finance](https://arbitrum.io/solutions/finance)
- [Arbitrum H1 2026](https://blog.arbitrum.foundation/arbitrum-h1-2026-the-programmable-economy-is-accelerating/)
- [Camelot Overview](https://docs.camelot.exchange/)
- [Camelot Sepolia contracts](https://docs.camelot.exchange/contracts/arbitrum/sepolia-testnet/)
- [Tenderly Arbitrum support](https://tenderly.co/blog/changelog/tenderly-node-arbitrum-support/)
- [Tenderly Arbitrum Sepolia](https://tenderly.co/blog/changelog/node-new-testnets/)
- [Enso supported networks](https://docs.enso.build/pages/build/reference/supported-networks)
- [HackQuest Open House](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
