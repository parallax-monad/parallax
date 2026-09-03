# 02-D｜验收标准与时间安排

> 状态：当前验收/时间参考。日期是计划，不是完成证明；文档 feasibility 不等于运行时能力已验证。

## 1. 阶段 Gate

### Pre-Buildathon

- Evidence Contract v0、Provider Interface 和最小 Registry 语义已 Review；
- `MossProvider` 可以承接现有路径，Risk/Core 不直接依赖 Moss-specific type；
- Monad × Kuru × Moss、Replay、Re-run、Action Gate 与 provenance 回归；
- Camelot/Tenderly/Native RPC 有真实 feasibility 记录；
- Receipt attestor 与 optional/non-blocking anchoring 边界已测试；
- `minimumReceived` 与用户 economic constraints 边界写清；
- Cause → Action → Re-verification 最小矩阵已形成。

### P0

- Arbitrum Sepolia × Camelot V3 × Tenderly 完成 quote、check、decision、Action 与 Re-run；
- Native RPC fallback 能力和 fail-closed 行为可验证；
- Evidence 包含 capabilities、provenance、freshness；
- 缺失 Evidence 不得被当作安全或 `PROCEED`；
- Receipt anchoring 可用时有 proof，失败时不阻断 decision；
- Monad baseline 仍然可运行。

### Strong / Best Case

- 可选第二 Provider 遵循同一 Interface/Contract；
- `Tenderly vs Native RPC` 同 transaction portability test 与 `Camelot/Tenderly vs Enso` 同 Intent execution-stack test 分开完成；
- Provider 切换不修改 Core 的 Risk、Cause、Action、Re-run；
- controlled/replay scenarios 覆盖 `UNKNOWN`、failure、stale 和 re-verification；
- SDK/reference/MCP 等扩展不破坏 P0。

## 2. 失败与 scope matrix

至少覆盖：不支持 Chain/Protocol/Token、无流动性/无 Route、Router/Quoter 错误、RPC timeout、Provider rate limit、Evidence incomplete/stale、unknown、Replay 与 Check Re-run 父级分离，以及 anchoring 失败但 decision 仍返回。

用户经济条件的最小目标矩阵包括 `HIGH_PRICE_IMPACT`、`MIN_EFFECTIVE_RATE_NOT_MET`、`MAX_TOTAL_COST_EXCEEDED`、`MAX_GAS_EXCEEDED`、`STALE_EVIDENCE`、`INCOMPLETE_EVIDENCE`。实现前必须确认真实 Evidence、字段和可验证改善条件；未确认时标为 planned/unresolved。

## 3. 时间安排（计划）

- **Internal target / code-freeze-submission target:** 2026-10-01
- **Official HackQuest submission deadline (verified 2026-09-02):** 2026-10-04 ([HackQuest listing](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon))

团队仍以 2026-09-30 完成最终 code freeze / video-ready build，并在 2026-10-01 完成内部 smoke、README、explorer proof、submission 与 backup。官方日期与内部 code-freeze / submission target 不同。

| 时间 | 目标 | 状态规则 |
| --- | --- | --- |
| 8/28–9/4 | Core 抽象、Contract、Provider research、Receipt design | 研究/实现混合，逐项核验 |
| 9/5–9/12 | Moss migration、Registry、Monad regression、Arbitrum spike | Gate：稳定 baseline |
| 9/13–9/18 | Arbitrum P0 quote/check/decision/re-run | Gate：可独立提交且 anchoring non-blocking |
| 9/19–9/25 | Strong：Arbitrum One、第二 Provider、portability | 只有 P0 稳定才推进 |
| 9/26–9/29 | Best Case comparison、SDK/reference、可选 MCP | 不得破坏 Strong |
| 9/30–10/1 | code freeze、smoke、README、提交备份 | 只处理阻塞项 |

## 4. 当前必须确认/不得猜测

Camelot Sepolia 真实池与 calldata、Tenderly credentials/rate limits、Native RPC 的最小 Evidence、目标 Token pair、Receipt registry 最终字段/事件/权限/网络、Enso 实际 route 支持、最终经济 Contract 和 freshness thresholds，都必须用真实 probe 或明确 Contract decision 确认。

Tenderly 与 Native RPC 在完成 credentialed real probes 前只能视为 `SUPPORTED_DOC_ONLY`，不得升级为已验证 Provider capability；Arbitrum Chain/Protocol/Registry 与 DecisionReceiptRegistry 仍是 planned work，不能从计划表升级为 implemented。

## 5. Scope Gate

```text
Pre-Buildathon 未稳定 → 继续完成 Core 和 baseline
P0 未稳定             → 不推进 Strong/Best
新增功能影响 Demo     → 回退到上一稳定版本
```
