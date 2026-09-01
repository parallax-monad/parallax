# Parallax 市场定位与证据研究

> 研究/策略参考，不是实现事实或产品承诺。
>
> 最后复核：2026-09-02；主要证据 cutoff：2026-08-29。动态市场数据在提交或发布前必须重新核验。

## 核心结论

公开证据没有证明“市场不存在 decision layer”。相反，pre-execution simulation、policy、guardrail 和 independent preflight 正在变得普遍。更可信的 Parallax wedge 是：

> **Parallax is a provider-agnostic pre-execution remediation and re-verification layer.**

也可以说：

> **Parallax turns heterogeneous transaction evidence into a deterministic cause and relevant action, then verifies whether the adjustment actually fixed the problem.**

核心闭环为：

```text
Intent → Evidence → Cause → Decision → Relevant Action → Re-verification
```

这是一项待验证的产品假设，不是 PMF、采用率或资金节省的证明。

## 证据等级与边界

| 等级 | 可引用材料 | 用途 |
| --- | --- | --- |
| A | 学术研究、独立 postmortem、官方链上数据、可复现 benchmark | 可进入主叙事，但仍需限定范围 |
| B | 厂商自报的 prevented-loss、saved-funds、客户案例 | 必须标注 vendor-reported，不可外推 TAM |
| C | 早期创业项目自发布 replay/data | 证明 use case/pattern，不代表行业统计 |

研究可支持 bad execution、MEV、slippage、price impact 和 failed transaction 会造成真实损失；但没有可信 aggregate dataset 能证明“每年因缺少 Parallax 而损失 X”。Parallax 也不是 MEV blocker，不能声称避免了与自身能力无关的 exploit。

## 需求与相邻证据

- Arbitrum 的金融活动和协议密度说明执行场景真实存在；DefiLlama 的动态数字（约 $1.2B TVL、$73M 24h DEX volume、约 94k active addresses 等）以 2026-08 页面为准，发布前应 refresh：[DefiLlama Arbitrum](https://defillama.com/chain/arbitrum)。
- 学术研究记录了 sandwich 与不利执行造成的用户损失；这证明问题真实存在，但不证明 Parallax 能阻止全部损失。[Sandwich study](https://www.sciencedirect.com/science/article/abs/pii/S0167739X25003711)
- Uniswap 官方说明 price impact、slippage tolerance 和 pending state 如何使“成功执行”仍不等于“符合用户意图”。[Price impact](https://support.uniswap.org/hc/en-us/articles/40074715860365-What-is-price-impact) · [Swaps](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps)
- Flashbots、Blockaid、Hypernative 与钱包的 pre-sign guard 说明交易前保护已有实际采用；相邻产品的 adoption/损失数字必须保留原始来源和证据等级。
- PACE 的 controlled benchmark 把 deterministic guard layer 与 agent execution 结合，支持“Agent 与执行之间需要可验证边界”，但作者也将结论限定在可复现 sandbox 中：[PACE](https://arxiv.org/abs/2608.17220)。

## 竞争边界与 Parallax wedge

市场已经有：

1. DEX/aggregator：quote、route、slippage 与 execution；
2. simulation/security：执行结果、trace、asset changes、malicious/risk signal；
3. wallet/policy/agent guard：授权、规则和 pre-sign block；
4. independent preflight：继续、复核或拒绝的终局判断。

ChainSage、TickTape、Hypernative Transaction Guard 与 PACE 说明“只做一个 decision layer”并不空白。Parallax 不应只竞争 `ALLOW/DENY`，而应验证更窄的闭环：

```text
Why not?
→ Which exact variable matters?
→ Relevant Action
→ Re-run
→ Did it actually improve?
```

这也意味着产品不能把“更多风险信息”当成差异化，不能把相邻产品的结果写成 Parallax 自己的效果。

## 可扩展架构与长期 surface

Moss 是第一套 Evidence Provider，而不是 Parallax 身份。长期拆分为：

```text
Chain × Protocol × Evidence Provider
```

Provider Adapter 统一不同上游的 Evidence、capabilities、provenance 和 freshness；SDK 是给开发者的调用面，MCP/Agent 是未来的 distribution surface，不是 Core 的替代品。没有 Moss 类上游时，标准 EVM 的 balance、allowance、`eth_call`、`estimateGas` 与 block context 仍可提供较窄 Evidence；缺失部分必须显示为 Not Checked/Unknown。

潜在长期 moat 不是某一个 Provider，而是：

- Evidence Schema；
- Cause taxonomy；
- Cause → Relevant Action mapping；
- Re-verification relationship；
- 经过真实验证的 Intent/Evidence/Before/After benchmark 数据集。

## Parallax 自己需要验证什么

后续应建立 `Parallax Decision Benchmark`，回答：有多少 simulation 成功但违反用户明确经济边界？被标记的 ADJUST 中有多少在 targeted adjustment 后通过 re-verification？应记录 False-Allow Rate、Recoverable Decision Rate、Economic Improvement、Decision Latency 和 Re-verification Success Rate。

在真实 usage 出现前，只能使用 controlled/replay scenarios 验证规则，示例数字不得填入 pitch。真实用户 benchmark、TAM、PMF 和 avoided value 均为未来工作。

## 研究边界

本文整合了市场需求/证据研究与 scalability 研究中的独特材料，解释“为什么”和可验证假设；当前实现、阶段顺序与 Owner 以 [`docs/planning/arbitrum-open-house/`](../planning/arbitrum-open-house/README.md) 及现有代码/合并文档为准。
