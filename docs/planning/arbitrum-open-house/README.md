# Arbitrum Open House 计划索引

> **历史计划资料（2026 年 9 月）。** 本目录保留 Arbitrum Open House 筹备与执行计划，供理解当时的决策和路线图。它不是当前规范，也不代表计划中的能力已经实现。
>
> 当前公开产品集成是 Arbitrum Sepolia × Camelot V3。Monad × Kuru × Moss 的代码、测试与证据属于历史兼容实验；不代表已完成的多链产品支持。当前行为以合并后的代码及 [文档索引](../../README.md) 中的开发参考为准。

## 如何阅读

这组文档把“为什么做”和“现在要怎么做”分开：

1. 先看合并后的代码、当前 API 合约和开发参考；它们说明当前实际行为。
2. `00` 与 `02-A`–`02-D` 记录当时的策略、架构、职责和验收设想，不再约束当前实现。
3. `docs/research/` 保留研究背景；研究结论不自动构成已交付能力。
4. `archive/` 保留有独立决策或历史价值的旧材料，不作为重复草稿的收容处。

## 当时记录的产品基线

本计划曾以以下路径描述早期兼容基线：

```text
Monad × Kuru × Moss
```

仓库保留了这条路径的代码、测试和历史证据，但它并未成为已完成的公开多链产品集成，也不是当前公开产品路径。Parallax 不签名、广播、执行或托管用户的 Swap。

当时，Generic Evidence / `MossProvider`、Chain Adapter 和 Arbitrum Provider feasibility 被列为准备阶段工作；其历史计划见 `02-B` 和 `02-D`。

## 工作流阶段映射

| 当时的工作流 | 当时的计划阶段 | 计划记录的 Owner |
| --- | --- | --- |
| Generic Evidence / Moss compatibility | Pre-Buildathon | Provider + Backend + Contract |
| Arbitrum Provider feasibility | Pre-Buildathon | Provider |
| Generic Chain Adapter | Pre-Buildathon | Backend |
| Camelot + Tenderly P0 | P0 | Backend + Provider |
| Decision Receipt | P0 | Backend |

## 当时规划的 P0（历史目标）

当时规划的组合是：

```text
Arbitrum Sepolia × Camelot V3 × TenderlyProvider
                               ↘ NativeRpcProvider（受控 fallback）
```

目标是让同一个 Parallax Core 复用 `Intent → Evidence → Cause → Decision → Relevant Action → Re-verification`，并以独立 backend attestor 生成可选、非阻塞的 `DecisionReceiptRegistry` commitment。该组合仍是计划，不是已部署声明。

## 文档地图

| 文档 | 用途 |
| --- | --- |
| [00-strategy-context](./00-strategy-context.md) | Open House 的战略背景和 P0/Strong/Best 收敛原则 |
| [02-overview](./02-overview.md) | 当时记录的基线、目标路径、约束与专题导航 |
| [02-A-architecture-boundaries](./02-A-architecture-boundaries.md) | Chain × Protocol × Evidence Provider、Core 与 Receipt 边界 |
| [02-B-provider-implementation](./02-B-provider-implementation.md) | Provider 顺序、阶段交付和两类 portability test |
| [02-C-ownership-collaboration](./02-C-ownership-collaboration.md) | 当时记录的 Owner 映射与协作规则 |
| [02-D-acceptance-timeline](./02-D-acceptance-timeline.md) | Gate、失败矩阵、时间安排和未决事项 |
| [市场与证据研究](../../research/market-positioning-and-evidence.md) | 需求、竞争边界、产品 wedge 与可验证假设 |
| [Arbitrum 生态与技术栈](../../research/arbitrum-ecosystem-and-stack.md) | Why Arbitrum、Camelot 与 Provider 选型依据 |

## Owner 参考

当时记录的职责映射见 [02-C](./02-C-ownership-collaboration.md)；当前职责应依据 CODEOWNERS 与对应的 live Issue/PR 确认。

## Archive policy

本目录原有的归档原则保留为历史维护约定；新增开发应以当前代码和 live GitHub 状态为准，避免把旧计划当作新的路线图。
