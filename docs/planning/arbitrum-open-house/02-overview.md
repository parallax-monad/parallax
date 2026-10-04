# 02｜Parallax 项目开发计划总览

> **历史计划资料（2026-09-01）。** 本文记录当时的开发计划，不是当前规范性实施计划。
>
> 当前公开集成是 Arbitrum Sepolia × Camelot V3。下文关于 Monad × Kuru × Moss、Provider 顺序、阶段和验收的内容均是历史计划记录；请以合并代码及当前 GitHub Issues/PRs 为准。

## 当时记录的基线与目标

当时的计划将 `Monad × Kuru × Moss` 描述为 verified baseline，其中的只读 quote/check、证据标准化、确定性规则、Replay、Re-run 和 Action Gate 记录的是历史兼容工作，不代表已完成的公开多链产品集成。Parallax 不签名、广播、执行或托管用户的 Swap。

当时的目标是在同一个 Core 上逐步增加：

```text
Arbitrum Sepolia × Camelot V3 × TenderlyProvider
                               ↘ NativeRpcProvider（受控 fallback）
```

以上组合和完成条件是计划当时的描述，不可作为当前运行状态；Tenderly 也不是当前 Native RPC 主路径的前置依赖。

## 当时记录的产品与架构约束

1. `Cause → Relevant Action → Re-verification` 是核心产品闭环。
2. 当前 Monad MVP/兼容路径中的 `economicBoundary.minimumReceived` 是随 Intent 传递的明确接受边界，溯源可为 `original_swap`、`user_declared`、`demo_preset` 或 `unavailable`；它不能被降低来制造 `PROCEED`。
3. 目标架构才将 `transactionProtection`（Protocol/DEX 的 `amountOutMinimum`、slippage protection）与 `userEconomicConstraints`（`maxPriceImpact`、`minEffectiveRate`、`maxTotalCost`、`maxGas` 等）分离；该迁移尚未在当前 `main` 完成。
4. backend attestor 可以签名并广播可选的 Decision Receipt commitment，但不签用户 Swap；anchoring 必须 optional / non-blocking。
5. Evidence Provider portability（同一 transaction，Tenderly vs Native RPC）与 execution-stack portability（同一 Intent，Camelot/Tenderly vs Enso）是两种不同测试。
6. 当前只用 controlled/replay scenarios 验证规则；没有真实 usage 前，不建立“真实用户 benchmark”或市场效果声明。

## Provider 顺序

```text
1. MossProvider          Monad × Kuru（现有路径）
2. TenderlyProvider      Arbitrum Sepolia P0 主路径
3. NativeRpcProvider     Arbitrum 受控 fallback
4. EnsoProvider          Strong / Best Case 可选
```

第一轮 Provider compatibility 应保持 Monad 回归，再推进 Arbitrum P0。

## 阶段总览

| 阶段 | 目标 | 交付/完成条件 |
| --- | --- | --- |
| Pre-Buildathon | Contract、MossProvider、Registry、feasibility、Receipt 准备 | 兼容抽象、Provider feasibility 与 Receipt 边界完成相应 Gate |
| P0 | Sepolia × Camelot V3 × Tenderly 的真实决策闭环 | 计划中；以真实 quote/check/decision/re-run 与 failure matrix 为完成条件 |
| Strong | Arbitrum One、第二 Provider、两类 portability proof | 计划中；必须建立两类 portability proof |
| Best Case | comparison、SDK/reference integration、可选 MCP | 计划中；扩展不得替代或破坏 Core/P0 |

## 文档导航

- [02-A｜开发决策与架构边界](./02-A-architecture-boundaries.md)
- [02-B｜Provider 与阶段实施计划](./02-B-provider-implementation.md)
- [02-C｜职责、接口与协作](./02-C-ownership-collaboration.md)
- [02-D｜验收标准与时间安排](./02-D-acceptance-timeline.md)
- [00｜战略背景](./00-strategy-context.md)

## 执行规则

- 未确认的 Chain、Protocol、Provider、Token pair 或 Contract 字段不能由 coding agent 猜测；
- 每个阶段先写清可核验的路径、测试与 Gate，再进入实现；
- 计划能力不等于实现或部署能力；
- P0 未稳定前不推进 Strong/Best。
