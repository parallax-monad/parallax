# Arbitrum Open House 计划索引

> 状态：公开的团队工作参考，2026-09-02 复核。
>
> **这些 planning 文档是公开的团队工作参考。计划中的能力不代表已经实现或已经部署。**

## 如何阅读

这组文档把“为什么做”和“现在要怎么做”分开：

1. 代码以及已经合并到 `main` 的实现文档，是当前实现事实；开放 PR 不是已交付能力。
2. `02-A`–`02-D` 是当前规范性的实施计划，约束架构边界、Provider 顺序、职责和验收 Gate。
3. `00-strategy-context.md` 与 `docs/research/` 下的研究文档提供背景和理由。研究结论只有在明确写入 02 系列后，才改变执行计划。
4. `archive/` 只保留仍有独立决策/历史价值的旧材料，不作为重复草稿的收容处。

## 当前已核验基线

截至本索引复核时，`main` 上的稳定产品路径是：

```text
Monad × Kuru × Moss
```

它包含只读的 quote/check、证据标准化、确定性决策、Replay、Re-run 和现有测试。Parallax 不签名、广播、执行或托管用户的 Swap。

Generic Evidence / `MossProvider`、Chain Adapter 和 Arbitrum Provider feasibility 分别在开放的 [PR #41](https://github.com/parallax-monad/parallax/pull/41)、[PR #43](https://github.com/parallax-monad/parallax/pull/43) 和 [PR #42](https://github.com/parallax-monad/parallax/pull/42) 中推进；这些 PR 在合并前不属于 `main` 的实现事实。

## 目标 P0

目标组合是：

```text
Arbitrum Sepolia × Camelot V3 × TenderlyProvider
                               ↘ NativeRpcProvider（受控 fallback）
```

目标是让同一个 Parallax Core 复用 `Intent → Evidence → Cause → Decision → Relevant Action → Re-verification`，并以独立 backend attestor 生成可选、非阻塞的 `DecisionReceiptRegistry` commitment。该组合仍是计划，不是已部署声明。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [00-strategy-context](./00-strategy-context.md) | Open House 的战略背景和 P0/Strong/Best 收敛原则 |
| [02-overview](./02-overview.md) | 当前基线、目标路径、约束与专题导航 |
| [02-A-architecture-boundaries](./02-A-architecture-boundaries.md) | Chain × Protocol × Evidence Provider、Core 与 Receipt 边界 |
| [02-B-provider-implementation](./02-B-provider-implementation.md) | Provider 顺序、阶段交付和两类 portability test |
| [02-C-ownership-collaboration](./02-C-ownership-collaboration.md) | 唯一的当前 Owner 映射与协作规则 |
| [02-D-acceptance-timeline](./02-D-acceptance-timeline.md) | Gate、失败矩阵、时间安排和未决事项 |
| [市场与证据研究](../../research/market-positioning-and-evidence.md) | 需求、竞争边界、产品 wedge 与可验证假设 |
| [Arbitrum 生态与技术栈](../../research/arbitrum-ecosystem-and-stack.md) | Why Arbitrum、Camelot 与 Provider 选型依据 |

## Owner 参考

当前语义 Owner 详见 [02-C](./02-C-ownership-collaboration.md)。简要区分如下：Kai 负责 Product，Rei 负责 Evidence Contract，Jie 负责 Provider，Clare 负责 Backend，Antony 负责 Frontend。

## Archive policy

旧材料只有在仍能独立说明历史决策、且其价值没有被 canonical 文档充分保留时才进入 `archive/`，并必须标明已被当前计划取代。可合并的内容应先进入本索引所指向的 canonical 文档，避免重复路线图。
