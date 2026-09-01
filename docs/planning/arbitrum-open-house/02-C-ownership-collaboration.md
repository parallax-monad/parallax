# 02-C｜职责、接口与协作

> 状态：当前唯一的语义 Owner 映射。Owner 是责任边界，不要求每个文件只有一个贡献者。

## 0. 三层审阅边界

- **CODEOWNERS**：提供自动审阅覆盖；广泛技术 Owner 让实现 PR 通常有多个候选审阅者。
- **02-C**：定义语义责任与最终决定权，不把每个文件强行归给单一 Owner。
- **PR-specific reviewer request**：根据当前 PR 的实际语义影响，额外邀请相应 Owner；不要求所有 Owner 审阅每个 PR。

## 1. 当前 Owner 映射

| Role | Owner | GitHub | Primary area |
| --- | --- | --- | --- |
| Product Owner | Kai | [@chin0312](https://github.com/chin0312) | Product, roadmap, user/business semantics, demo |
| Contract Owner | Rei | [@rainypilgrimage](https://github.com/rainypilgrimage) | Evidence Contract semantics and compatibility |
| Provider Owner | Jie | [@jzhao0](https://github.com/jzhao0) | Provider research and Provider Adapter implementation |
| Backend Owner | Clare | [@brightheartma](https://github.com/brightheartma) | Backend, adapters, integration, Receipt Smart Contract |
| Frontend Owner | Antony | [@antony819](https://github.com/antony819) | Frontend and UX |

### Product Owner

负责产品研究与定义、定位、路线图、范围优先级、Cause/Action/STOP/ADJUST/UNKNOWN/PROCEED 语义、Re-verification acceptance、前端/产品协调、Contract 协调和 demo/pitch 叙事。

### Contract Owner

“Contract”指 Evidence/data Contract，不是 Solidity Owner。Rei 负责最小 Contract framework、跨模块语义、版本与兼容性，审核 Provider/Backend 提案并解决冲突，维护唯一 canonical 版本。

### Provider Owner

Jie 负责 Moss、Tenderly、Native RPC、Enso 等 Provider 的研究、真实 probe、能力/字段解释、具体 Adapter、normalization、fixtures 和 compatibility tests。Moss 是具体 Provider 路径，不是一个独立的当前通用角色。

### Backend Owner

Clare 负责通用 backend 架构、Chain/Protocol Adapter、Provider Interface/Registry、composition、Evidence pipeline、Risk/Cause/Action/Re-run 接入、API，以及 `DecisionReceiptRegistry` 的实现、attestor、部署与 proof。Smart Contract engineering 属于 Backend Owner，不单列独立的当前合约工程角色。

### Frontend Owner

Antony 负责 Network/Protocol/Token UX、Evidence/provenance/capabilities、Cause/Action/Re-run、Receipt、loading/failure/stale/unsupported 与 demo/debug UI。

## 2. 协作规则

- Provider Owner 与 Backend Owner 发现并提出具体实现语义；
- Contract Owner 最终决定 canonical Evidence Contract 语义和兼容性；
- Product Owner 在字段影响用户决策、范围或业务语义时参与 Review；
- Backend attestor 的 Receipt 签名不能变成用户 Swap 签名；anchoring 故障不能阻断 decision；
- 角色不等于审查门槛，不要求所有 Owner 对每个 PR 逐一批准。

## 3. Adapter 边界

```text
Chain Adapter
  chainId / RPC / block / gas / finality

Protocol Adapter
  quote / route / calldata / unsigned transaction

Evidence Provider Adapter
  evaluate / normalization / capabilities / provenance / freshness
```

Parallax Core 只消费统一 Evidence，不直接依赖 Moss/Tenderly/Enso 原始类型。Provider 通常由 Backend Registry 选择，不作为普通用户必须填写的 Intent 字段。

## 4. API 与 Frontend 协作

Frontend 提交统一 Swap Intent；Backend 选择 Chain、Protocol、Provider 并返回 Evidence、capabilities、provenance、freshness、Cause、Relevant Action、Re-run 和 Receipt。当前 Monad 兼容路径中的 `economicBoundary.minimumReceived` 是显式接受边界，来源可为 `original_swap`、`user_declared`、`demo_preset` 或 `unavailable`。目标架构才把 Protocol/DEX `transactionProtection` 与 `userEconomicConstraints` 分离；未被当前 Contract/Provider 支持的目标条件必须公开为未检查或 `UNKNOWN`。
