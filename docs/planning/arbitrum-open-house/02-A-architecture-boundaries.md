# 02-A｜开发决策与架构边界

> 状态：当前规范性架构计划；未将未来 Arbitrum 能力标记为已实现。

## 1. 产品边界

- Parallax 是 pre-execution decision/remediation layer，不是 DEX、交易执行器、钱包或完整安全扫描器；
- 当前产品范围是 Swap-only；
- Parallax **永远不签名、广播或执行用户的金融交易**。独立 backend attestor MAY 为可选 Decision Receipt commitment 签名/广播；
- `PROCEED` 只表示在本次已检查范围内没有发现阻断证据，不是安全保证或投资建议；
- Evidence 不完整、过期、不可验证或 Provider 不支持时，必须公开表达 `UNKNOWN`/unsupported 等状态，不能静默通过。

## 2. 长期分解

```text
Chain × Protocol × Evidence Provider
```

### Chain Adapter

负责 chain ID、RPC、区块上下文、Gas、finality 与链连接错误。

### Protocol Adapter

负责 quote、route、unsigned transaction、router/quoter、calldata、Token pair 和协议错误。它不决定产品 Verdict。

### Evidence Provider Adapter

负责 simulation 或其它 Evidence 获取、Provider-specific 解析、capabilities、provenance、freshness 和失败状态标准化。原始 Provider 类型不能泄漏到 Core。

### Parallax Core

Core 只消费统一 Evidence Contract，执行 `Cause → PROCEED / ADJUST / STOP / UNKNOWN → Relevant Action → Re-verification`。Risk/Product 语义不绑定 Moss、Tenderly 或其它 Provider。

### Generic Evidence

最小 v0 覆盖 `Intent`、unsigned `Transaction`、Evidence/Outcome、Provenance、Capabilities 与 `SUCCESS`、`UNKNOWN`、`UNSUPPORTED`、`FAILED`、`STALE` 等状态。契约由 Contract Owner 维护唯一版本。

### DecisionReceiptRegistry

Registry 只保存 Receipt commitment/metadata（例如 intent/evidence/decision hash、区块与时间）。backend attestor 的签名和链上 anchoring 与用户 Swap 分离；anchoring 异步、optional、non-blocking，失败不得阻断 decision。

## 3. 当前路径与目标路径

```text
当前 verified：Monad × Kuru × Moss
    ↓
现有业务行为、Replay、Re-run、Action Gate 与测试

目标 P0：Arbitrum Sepolia × Camelot V3 × Tenderly
    ↓
同一个 Core 与 Evidence Contract
```

Arbitrum 的 Protocol/Provider 仍需真实 feasibility 和集成验证。`MossProvider` 是第一套 Provider，而不是 Parallax 的长期身份。

## 4. Evidence Contract 与经济边界

### 当前 Monad MVP / 兼容语义

`economicBoundary.minimumReceived` 是当前 Monad MVP 随 Intent 传递的明确接受边界。其 provenance 可以是 `original_swap`、`user_declared`、`demo_preset` 或 `unavailable`；它不能被降低来制造 `PROCEED`。

### 目标架构语义

目标架构将 `transactionProtection`（协议/DEX 的 `amountOutMinimum`、slippage protection）与 `userEconomicConstraints` 分开表达，后者可包含 `maxPriceImpact`、`minEffectiveRate`、`maxTotalCost`、`maxGas` 等条件。交易可执行但不满足这些目标条件时，应产生对应 Cause，并进入 Action/Re-verification；这套分离尚未在当前 `main` 全部实现。

## 5. Provider portability

### Evidence Provider portability

固定同一 transaction 和 execution inputs，只替换 Tenderly/Native RPC，比较 Evidence、capabilities、provenance、freshness 与状态语义。

### Execution-stack portability

固定同一个用户 Intent，允许 Camelot/Tenderly 与 Enso 产生不同 transaction、route 或 calldata，比较 Intent-level quote、经济边界、Decision 与 re-verification。两者不能合并成一个“Provider 评分”。
