# 02-B｜Provider 与阶段实施计划

> 状态：当前 Provider/阶段计划。未完成的 Provider 仍须以真实 probe 证明；文档支持不等于运行时支持。

## 0. 阶段执行分工

- **Provider Owner**：外部工具调研、Provider Adapter、Provider-specific mapping、真实响应和 fixtures；
- **Backend Owner**：Provider Interface、Registry、pipeline、API 与系统级集成；
- **Contract Owner**：最小 Evidence Contract、兼容性与版本的最终 Review；
- **Product Owner**：产品决策、边界和用户语义；
- **Frontend Owner**：Evidence、scope、Cause、Action、Re-run 与 Receipt UX。

## 1. Provider 顺序

### Phase 1：MossProvider

把现有 `Monad × Kuru × Moss` flow 封装到 Provider Interface，保持 Generic Evidence、Replay、Re-run、Action Gate、provenance 与测试回归。这是 Pre-Buildathon compatibility stage，完成后应能在不引入 Moss-specific type 依赖的情况下通过 Monad 回归。

### Phase 2：TenderlyProvider

目标为 Arbitrum Sepolia P0：simulation、execution result、asset/balance changes、gas、revert、block/freshness、capabilities 与统一 Evidence。在完成 credentialed real probe 前，Tenderly 只能保持 `SUPPORTED_DOC_ONLY`，不得描述为已验证运行时能力。

### Phase 3：NativeRpcProvider

作为受控 fallback，使用 `eth_call`、`estimateGas`、state/balance/allowance 等能力；能力不足必须 `UNKNOWN`，不做 consensus、自动评分或 dynamic routing。真实 Arbitrum RPC probe 尚未完成。

### Phase 4：EnsoProvider（可选）

Strong/Best Case 再验证 Arbitrum One、协议、Token、route、经济字段和 provenance。它不是 P0 前置条件。

## 1.1 两类 portability test

| 测试 | 固定项 | 可变项 | 证明目标 |
| --- | --- | --- | --- |
| Evidence Provider portability | 同一 transaction、Chain、Protocol、calldata、value | Tenderly vs Native RPC | Evidence 来源可替换，能力差异可公开 |
| Execution-stack portability | 同一用户 Intent | Camelot/Tenderly vs Enso 的 transaction/route/calldata | 上层 Core 不依赖某一执行栈 |

## 2. 阶段实施

### Pre-Buildathon（计划：8/28–9/12）

Evidence Contract v0、MossProvider compatibility、Contract tests、Monad regression、Registry、Camelot/Tenderly/Native RPC feasibility、Receipt attestor 与 non-blocking anchoring 设计。Gate 是稳定的 `pre-arbitrum-buildathon` baseline。

### P0（计划：9/13–9/18）

```text
ArbitrumChainAdapter
→ CamelotV3ProtocolAdapter
→ TenderlyProvider
→ NativeRpcProvider fallback
→ Evidence normalization
→ Parallax Core
→ Cause / Decision / Action / Re-run
→ optional Decision Receipt anchor
```

同时回归 `Monad × Kuru × Moss`。P0 只有在真实 quote/check/decision/re-run 和 failure matrix 通过后才可标记完成。

### Strong（计划：9/19–9/25）

Arbitrum One、可选 Enso、两类 portability test、capabilities/provenance UX、Minimal SDK 与 Receipt UX。任何扩展都不能破坏 P0。

### Best Case（计划：9/26–9/29）

Provider comparison、reference integration、可选 MCP/Agent。SDK/MCP 是 distribution surface，不是 Core 的替代品。

## 3. 阶段 Gate 与可推进范围

在对应阶段内可以推进 Contract/Provider 接口、Moss compatibility、Registry、通用 provenance/capabilities/freshness、Contract tests、DecisionReceiptRegistry 设计和 feasibility spike；未有真实证据的 Provider 必须保持 `SUPPORTED_DOC_ONLY` 或 unresolved。

阶段 Gate 不以真实用户 benchmark 为前提；在真实 usage 建立前，仅在 controlled/replay scenarios 中验证 Cause、Action 和 Re-verification 规则。
