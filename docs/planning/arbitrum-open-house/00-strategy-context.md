# 00｜Arbitrum Open House 战略背景

> 状态：研究驱动的战略参考，不是实现承诺。具体交付以 `02-A`–`02-D` 为准。
>
> **这些 planning 文档是公开的团队工作参考。计划中的能力不代表已经实现或已经部署。**

## 为什么参加 Open House

Arbitrum Open House 提供了一个清晰的外部证明场景：在不重写 Parallax Core 的前提下，把当前 Monad × Kuru × Moss 路径扩展到一个 Arbitrum 原生的 Swap 组合。比赛的价值不是把支持的功能数量做大，而是用真实的 Chain、Protocol 和 Evidence Provider 证明边界可替换。

这套叙事应保持克制：Arbitrum 扩展仍需按 02-A–02-D 完成真实 feasibility 与集成验证，不能把计划能力写成已部署能力，也不能把外部市场数字当成 Parallax 自己的效果数据。

## Before / During Buildathon

### Before：先解决内部抽象

- 最小 Evidence Contract 与版本/兼容规则；
- `Chain × Protocol × Evidence Provider` 的接口边界；
- `MossProvider` compatibility、Registry 和 Contract tests；
- Monad × Kuru × Moss 回归；
- Camelot、Tenderly、Native RPC 的真实 feasibility spike；
- `DecisionReceiptRegistry` 的范围、attestor 和非阻塞边界。

### During：再完成外部证明

```text
Arbitrum Chain
→ 一个 Swap Protocol
→ 一个 Evidence Provider
→ 同一个 Parallax Core
→ Cause / Decision / Relevant Action / Re-verification
→ 可选 Decision Receipt commitment
```

## 为什么是 DecisionReceiptRegistry

Receipt registry 只记录 `Intent`、Evidence 和 Decision 的 commitment/metadata，用于可验证性和审计。独立 backend attestor 可以签名并广播该 commitment；这与用户 Swap 完全分离。链上 anchoring 必须 optional / non-blocking，合约或 RPC 故障不能阻断离线 decision 返回。batch/Merkle 优化属于后续产品阶段。

## P0、Strong、Best Case

| 阶段 | 要回答的问题 | 交付边界 |
| --- | --- | --- |
| P0 | Arbitrum 路径是否真的能跑？ | Sepolia、一个 Protocol、一个主 Provider、受控 fallback、完整 Decision loop |
| Strong | 架构是否真的 portable？ | Arbitrum One、第二 Provider、provenance/capabilities 与 portability 证明 |
| Best Case | 是否已经像可复用基础设施？ | 可展示的 Provider comparison、SDK/reference integration，MCP/Agent 仅为 stretch |

每个阶段都必须可独立收敛；如果 P0 不稳定，不推进 Strong/Best 的扩展。详细阶段任务在 [02-B](./02-B-provider-implementation.md)，验收 Gate 在 [02-D](./02-D-acceptance-timeline.md)。

## 评审叙事边界

最强的简短叙事是：一笔交易可能合法、可执行且没有恶意信号，但仍不符合用户明确的经济边界。Parallax 将异构 Evidence 转为 Cause、Decision 和 Relevant Action，并在修改后重新验证。当前仓库尚无真实 Arbitrum benchmark，不应声称已经节省真实资金或达到 PMF。
