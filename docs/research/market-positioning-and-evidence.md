# Parallax 需求与市场证据研究
## 市场缺口、用户损失、AI Agent 风险、相邻成功案例与可验证产品假设

> 状态：canonical research/strategy reference；不是实现事实或产品承诺。
>
> 最后复核：2026-09-02；主要证据 cutoff：2026-08-29。动态数据在发布前必须重新核验。

> 更新时间：2026-08-29
> 目的：为 Parallax 的产品需求、Open House submission、pitch deck 和后续产品验证提供**可引用、可核查、不过度推断**的证据基础。
> 原则：严格区分 **直接证据、相邻证据、厂商自报数据、研究推论和 Parallax 自己仍需验证的假设**。

---

# 1. 核心结论

这轮研究没有证明“市场完全没有 decision layer”。相反，市场正在快速向 pre-execution simulation、policy、guardrail 和 independent preflight 收敛。

目前可以被真实证据支持的结论是：

1. **DeFi 执行风险和 bad execution 会造成真实经济损失。** Slippage、price impact、MEV、sandwich 和 failed transactions 都有学术或行业数据支持。
2. **Pre-execution protection 已有真实采用证据。** Flashbots、Blockaid、Hypernative 以及主流 Agent Wallet 都把交易前检查做成核心产品能力；其中部分规模与价值指标来自厂商自报。
3. **AI Agent 不能被假设为可靠的金融决策者。** 学术 benchmark 显示 LLM 的 general intelligence 并不自动转化为好的 financial risk management；最新 PACE 研究也直接测试 deterministic guard layer 对 unsafe execution 的影响。
4. **“Should this execute?” 已经有直接竞品。** ChainSage、TickTape、Hypernative、PACE 都与这个方向重叠。
5. **Parallax 更可信的缺口是 remediation + re-verification。** 即：不仅告诉用户/Agent“不应该执行”，而是解释 Cause、指出应该改变哪个 relevant variable，并重新验证调整是否真的解决问题。

因此，Parallax 不应该再把自己描述成：

> “The missing decision layer.”

更准确的定位是：

> **A provider-agnostic pre-execution remediation and re-verification layer.**

或：

> **Parallax turns heterogeneous transaction evidence into a deterministic cause and relevant action, then verifies whether the adjustment actually fixed the problem.**

---

# 2. 证据等级

为了避免 pitch 中把营销数字写成事实，建议内部统一采用三档证据等级。

## A — 高可信直接证据

- peer-reviewed / academic empirical research
- 独立技术 postmortem
- 官方链上 / protocol data
- 可复现 benchmark

这类可以进入主 pitch。

## B — 厂商自报数据

例如 Blockaid prevented-loss、Hypernative saved funds、customer case study。

可以使用，但必须标明：

> vendor-reported / according to the company

## C — Early startup self-published data

例如 TickTape 自己发布的 replay dataset。

适合证明 use case / product pattern，不适合外推全行业。

---

# 3. Arbitrum：需求发生在多大的环境里？

> 证据等级：A（官方/公开链上数据，动态统计）。

DefiLlama 在 2026-08 的 Arbitrum 页面显示约：

- **$1.2B DeFi TVL**
- **$3.475B stablecoin market cap**
- **$73.09M 24h DEX volume**
- **$613.86M 24h perpetual volume**
- **94,716 24h active addresses**
- **1.3M 24h transactions**

Source: https://defillama.com/chain/arbitrum

这些数字每日变化，submission 前应 refresh。

Arbitrum Foundation 的 H1 2026 总结进一步报告：

- H1 新增约 **474M transactions**
- lifetime transactions 超过 **2.7B**
- stablecoin holders **10.5M**
- monthly stablecoin transfer volume 超过 **$60B**
- **1,142 live projects**
- RWA AUM 约 **$850M**
- derivatives OI 半年增长 **434%**，峰值约 **$1.5B**

Source: https://blog.arbitrum.foundation/arbitrum-h1-2026-the-programmable-economy-is-accelerating/

这证明 Parallax 不是在一个缺乏真实金融活动的测试环境中寻找需求。

---

# 4. “Bad execution” 真的会导致经济损失吗？

答案是：**会。**

但要区分：

```text
A. adversarial execution / MEV
B. normal slippage / price impact
C. failed / reverted transaction
D. explicit user-intent mismatch
```

A-C 有大量现成证据；D（Parallax 最关心的“交易成功但不满足用户自己的 economic boundary”）目前缺少行业统一 aggregate loss 统计。

所以不能写：

> “每年有 $X 因为没有 Parallax 而损失。”

---

# 5. Sandwich / MEV：数亿美元级用户损失已有实证

> 证据等级：A（学术实证研究）。

2026 年发表的研究 “An anti-sandwich mechanism for EVM’s smart contracts” 使用约 3 年数据集，报告：

- **1,330,732 sandwich attacks**
- 记录约 **$809,453,320 end-user losses**

Source: https://www.sciencedirect.com/science/article/abs/pii/S0167739X25003711

可以安全写：

> Adversarial execution is not theoretical; empirical research has measured hundreds of millions of dollars in sandwich-related user losses.

不能写：

> Parallax 可以避免这 $809M。

Parallax 目前不是 MEV blocker。

---

# 6. 更广义 MEV extraction 仍然巨大

> 证据等级：A（学术实证研究）。

2026 年 Blockchain: Research and Applications 论文对 Ethereum MEV 的两年数据做分析，报告：

- linked attack strategies 提取超过 **$5B**
- traditional attacks 约 **$382M**

Source: https://www.sciencedirect.com/science/article/pii/S2096720925000673

这代表 execution environment 中持续存在巨大的经济 extraction，但不能直接把 attacker profit 等同于 Parallax-addressable loss。

---

# 7. 用户遇到坏执行后会真实改变行为

> 证据等级：A（独立研究与交易级数据）。

“Sandwiched and Silent” 使用 2024-11 至 2025-02 的 transaction-level data，发现：

- 2024-11 至 12 月确认 **2,932 private sandwich attacks**
- 影响 **3,126 private victim transactions**
- victim losses 约 **$409,236**
- public sandwich victims 中约 **40%** 在 60 天内迁移到 private routing
- repeated exposure 后上升到 **54%**
- 按该研究的方法，首次 sandwich 后的 churn 最高约 **7.5%**，随后降至约 **1–2%**

Source: https://arxiv.org/abs/2512.17602

这证明坏执行不仅损失钱，也会改变用户 execution behavior。

同时它说明：

> **切到另一条 private route / provider 本身也不能保证问题解决。**

这与 Parallax 的 provider-independent verification thesis 相符。

---

# 8. Arbitrum 自己也观察到 sub-optimal swaps

> 证据等级：A（生态/资金管理研究；历史场景）。

Arbitrum Treasury Management research 观察到：

- individual swaps 的 slippage 有时达到 average 的一个数量级以上；
- 某一时期约 **113k ARB** 的卖出就可能带来超过 **2%** price impact；
- 另一个时期约 **1M ARB** 才达到类似水平；
- 报告认为存在大量 sub-optimal execution；
- limit orders、TWAP、waiting for better liquidity 都可以改善结果。

Source: https://forum.arbitrum.foundation/t/arbitrum-treasury-management-report-by-aera/20652

这是 2023/24 的 liquidity environment，不能当作 2026 当前市场统计；但它非常适合说明：

> **“同样的交易意图现在应不应该执行”是 state-dependent decision problem，而不是单纯 protocol correctness。**

---

# 9. Uniswap 官方也承认：successful swap 不等于 good outcome

> 证据等级：A（协议官方机制说明）。

Uniswap 官方资料明确指出：

- price impact 越高，用户可能承受越大 loss；
- slippage tolerance 太低会导致 failed transaction；
- slippage tolerance 太高可能导致成交价格明显差于 quote；
- pending 期间价格环境可能变化；
- integrations 通常需要在 protocol execution checks 上增加 user protection checks。

Sources:

- https://support.uniswap.org/hc/en-us/articles/40074715860365-What-is-price-impact
- https://developers.uniswap.org/docs/get-started/concepts/traders/swaps
- https://blog.uniswap.org/es-ES/minimize-slippage-on-swaps

这直接支持 Parallax 的核心逻辑：

```text
Protocol:
“This transaction can execute.”

Decision layer:
“Is this outcome acceptable for this user's intent?”
```

---

# 10. 历史研究：大量 DEX trades 曾以 unfavorable rate 执行

> 证据等级：A（学术研究；历史数据）。

一项 Uniswap / SushiSwap empirical study 报告：

> nearly 30% of analyzed trades were executed at an unfavorable rate.

Source: https://arxiv.org/abs/2203.07774

这是较早期市场研究，只能作为 historical evidence，不能写成“今天 Arbitrum 有 30% swap 是错的”。

---

# 11. Pre-execution protection 是否已经证明有实际价值？

相邻产品已经提供较强的真实采用和价值证据，但厂商自报结果不能直接外推为 Parallax 的效果。

---

# 12. Flashbots Protect：数千万真实交易采用保护层

> 证据等级：B（产品方公开 telemetry）。

Flashbots Protect 当前页面显示：

- **66M+ transactions processed**
- **7,733+ ETH refunds earned**

Source: https://protectrpc.flashbots.net/

Flashbots 的公开数据还说明 Protect 提供：

- private routing
- frontrunning / sandwich protection
- revert protection
- 交易若会 revert，则不会被执行，避免为失败交易支付 gas

Source: https://collective.flashbots.net/t/publishing-flashbots-protect-and-mev-share-data/3087

这不是 Parallax；作为厂商公开 telemetry，它提供了相邻采用与价值证据：

> **在 execution 前增加一层 independent protection，可能创造足够价值让真实交易采用。**

---

# 13. CoW：Intent-based execution 可以产生可量化 user surplus

> 证据等级：B（协议/论坛报告）。

CoW DAO 的历史 service agreement 报告某一年：

- 约 **$359M user surplus**
- Mainnet volume 约 $6.5B
- Arbitrum volume 约 $113M
- trades 获得 MEV protection

Source: https://forum.cow.fi/t/cip-58-funding-for-development-services-service-agreement-no-4/2686

### 2026 年规模补充

CoW DAO 的 2026 年月度回顾与核心团队治理说明进一步报告：

- 累计交易量超过 **$200B**；
- 超过 **12M trades**；
- 自 2024 年开始产生收入以来，DAO / 产品收入约 **$41.9M–$42M**；
- 累计返还用户的 surplus 约 **$1.21B**。

Sources: [CoW DAO Monthly Recap: May 2026](https://forum.cow.fi/t/cow-dao-monthly-recap-may-2026/3463), [CoW DAO's Path to Value Distribution](https://forum.cow.fi/t/cow-daos-path-to-value-distribution-core-team-view/3454)

这些是 CoW DAO / 核心团队 / 社区论坛报告的规模指标，不是独立审计统计，也不证明 Parallax 的 PMF。它们支持的较窄结论是：intent-based execution / protection 已经达到有意义的真实使用规模。

CoW 的模式：

```text
User intent
↓
solver competition
↓
better execution / MEV protection
```

Parallax 不应该复制它；更合理的互补是：

```text
CoW / Camelot / Enso:
find or construct execution

Parallax:
judge evidence, explain Cause, remediate, re-verify
```

---

# 14. Blockaid：pre-sign protection 已经成为 wallet infrastructure

> 证据等级：B（厂商公开指标；页面间存在口径差异）。

Blockaid 当前官方页面称：

- **180M+ Web3 transactions protected every month**
- homepage 显示 **5.9B transactions scanned**
- homepage 显示约 **$13.1B theft prevented**

Sources:

- https://blockaid.io/
- https://blockaid.io/transaction-security

注意：Blockaid 不同页面上的 prevented-loss 数字会变化，其他页面甚至显示 $14.7B+。

因此只能写：

> **Blockaid reports ...**

不能写成 audited market statistic。

真正重要的信号是：

> pre-sign simulation / validation 已经被大量 wallet transaction flow 使用。

---

# 15. Hypernative：pre-sign guard 可以减少 manual review burden

> 证据等级：B（厂商指标与客户案例）。

Hypernative Transaction Guard 官方称：

- 300+ risk types
- **$3B+ saved in active incidents**
- Edge Capital customer story：manual transaction reviews 减少最高约 **90%**

Source: https://www.hypernative.io/product/transaction-guard

Edge Capital case 还描述：

- 每天执行 hundreds of DeFi transactions；
- 原本通过大型 spreadsheet 管理 hundreds of parameters / protocol-specific checks；
- 随着规模与协议复杂度增长，manual system 无法 scale。

Source: https://hypernative.io/insights/blog/how-edge-capital-scaled-transaction-security-and-expanded-defi-reach-with-hypernative-guardian

该厂商客户案例提示，Evidence / rule / decision fragmentation 不只是 retail UX 问题，也可能是 institutional operational problem；它不是独立审计的普遍性证明。

---

# GoPlus AgentGuard：runtime action security / trust guard

> 证据等级：B（官方开源项目与产品说明）。

[GoPlus AgentGuard](https://github.com/GoPlusSecurity/agentguard) 关注 Agent action 的运行时评估与安全/信任规则，包括：

- runtime action evaluation；
- trust registry 与 rule-based guard functionality；
- MCP / SDK 等 Agent 接入面；
- 在适用场景下提供 transaction simulation 或其他 security Evidence；
- 对能力不可用时的 graceful degradation。

它与 transaction/action guarding 存在重叠，但重点更偏安全与授权边界，而不是独立的用户经济意图修正。产品区分可以写成：

```text
GoPlus AgentGuard
→ runtime security / action guard

Parallax
→ heterogeneous Evidence
→ economic / user intent
→ Cause
→ targeted remediation
→ Re-verification
```

这不是“GoPlus 没有某项能力”的断言；它只是按公开材料区分两者当前关注的决策边界。

---

# 16. Bybit：错误 approval path 可以产生灾难级损失

> 证据等级：A（独立技术分析）。

NCC Group 对 2025 Bybit hack 的独立技术分析显示：

- 损失超过 **$1.4B**；
- 攻击破坏 transaction approval / UI flow；
- signers 以为自己批准正常 internal transfer；
- 实际批准了会改变 wallet control 的 transaction。

Source: https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/

可用于支持：

> **what is displayed / intended 与 what is actually executed 之间需要 independent verification。**

但不能说：

> Parallax would have prevented the Bybit hack.

当前 Parallax 没有足够能力支持这个 claim。

---

# 17. AI Agent：有没有“因为缺 decision layer 损失 $X”的行业统计？

## 没有找到可信 aggregate dataset

目前不建议写：

> “AI agents 已因缺少 Parallax-like layer 损失 $X billion。”

Agent Wallet 类别本身非常新，production loss history 还不成熟。

更可靠的证据来自：

1. 大型 wallet 的设计收敛；
2. agent financial benchmark；
3. controlled safety research。

---

# 18. MetaMask Agent Wallet：把 agent 当作“不可信 proposer”

> 证据等级：B（官方产品/安全说明）。

MetaMask 2026 Agent Wallet 的官方 security framing 非常重要：

> agent 应被视为 unfamiliar transaction proposer，而不是 trusted signer。

其 execution path 包含：

- transaction simulation
- threat scanning
- MEV protection
- spend limits
- protocol allowlists
- human approval / 2FA escalation

Sources:

- https://metamask.io/news/introducing-metamask-agent-wallet
- https://metamask.io/news/agentic-wallet-security

MetaMask 还明确指出：

> signing isolated but permissions unlimited 时，被操纵的 agent 仍然能执行 wallet 所允许的一切。

这直接验证 deterministic external guardrail 的必要性。

---

# 19. OKX Agentic Wallet：每笔交易先 simulation + risk grading

> 证据等级：B（官方产品说明；平台级指标需单独归因）。

OKX Agentic Wallet 官方描述：

- every transaction simulated first
- plain-language description
- risk grading
- critical transaction blocked
- nearly 20 chains
- MCP / CLI agent access

OKX 称 Onchain OS 整体处理：

- **1.2B+ daily API calls**
- **$300M daily trading volume**

注意：这是 Onchain OS 整体，不是 Agentic Wallet 单独数据。

Source: https://www.okx.com/en-sg/learn/agentic-wallet

意义：

> major execution provider 并没有把 LLM 的自身判断当作充分安全机制。

---

# 20. Coinbase Agentic Wallet：autonomy 仍然需要 deterministic boundaries

> 证据等级：B（官方产品说明）。

Coinbase Agentic Wallets 提供：

- session caps
- transaction limits
- enclave key isolation
- KYT screening
- autonomous DeFi execution

Source: https://www.coinbase.com/developer-platform/products/agentic-wallets

再一次说明：

```text
Agent autonomy
≠
unbounded execution
```

---

# 21. AI-Trader：General intelligence 不等于 financial risk control

> 证据等级：A（学术 benchmark）。

HKU AI-Trader benchmark：

- 6 个主流 LLM
- US stocks / A-shares / crypto
- live autonomous financial environment
- 研究发现多数 agents 有 poor returns 和 weak risk management
- risk control capability 是跨市场 robustness 的关键

Source: https://arxiv.org/abs/2512.10971

这不能证明 Parallax 会提升 agent alpha。

它可以支持：

> **不要让 LLM 自身的 general reasoning 充当最终 financial risk control。**

---

# 22. PACE：目前最强的 deterministic agent-guard benchmark

> 证据等级：A（受控学术 benchmark）。

2026-08-18 发布的：

> PACE — Policy-Attested Contract Execution for Safe AI Agents in DeFi

设计：

```text
LLM Agent
↓
typed transaction intent
↓
deterministic policy verifier
↓
simulation report
↓
signed Policy Decision Record
↓
exact transaction bytes
↓
onchain enforcement
```

实验：

- 40 tasks
- 4 attack categories + benign utility
- **2,800 trials**
- 10 seeds

论文报告，在 deterministic sandbox 中：

```text
Unguarded baseline unsafe execution rate: 0.80
PACE unsafe execution rate: 0.00
PACE false positive rate on benign tasks: 0.00
```

Source: https://arxiv.org/abs/2608.17220

重要 caveat：作者自己将 claim 限定为：

> logic-level safety in a reproducible benchmark

不是 production-ready guarantee。

PACE 研究系统还报告了约 **29,826–31,822 gas** 的额外开销；这是该受控 benchmark 中的测量结果，不是 Parallax 的生产性能结论。

---

# 23. PACE 对 Parallax 的双重意义

## 正面

它强力支持：

> **Agent 和 execution 之间需要 deterministic verifier / policy layer。**

## 竞争压力

也说明：

> “Agent Guard / Decision Layer”本身已经不是足够的新颖点。

Parallax 必须往下一层走：

```text
heterogeneous evidence
+
economic intent
+
Cause
+
Relevant Action
+
Re-verification
```

---

# 24. 直接竞品：ChainSage

> 证据等级：B（产品方公开材料）。

Source: https://www.chainsage.finance/

ChainSage 的 positioning 与我们高度接近：

> “Settlement moves money. Authorization grants permission. ChainSage decides whether it should happen.”

其公开 pipeline：

```text
Agent Intent
↓
Simulation
↓
Risk Engine
↓
Policy Engine
↓
Trust Network
↓
ALLOW / REVIEW / DENY
↓
Execution
```

产品 surface 包括：

- Risk API
- Agent SDK
- Policy Engine
- Trust Network
- read-only Guardian

因此必须承认：

> **decision layer between intent and execution 已经有 direct competitor。**

---

# 25. ChainSage 与 Parallax 当前最可能的差异

根据目前公开页面，没有看到 ChainSage 把以下闭环作为核心：

```text
Cause
↓
Which exact variable should change?
↓
Relevant Action
↓
Adjustment
↓
Re-run
↓
Did it actually improve?
```

ChainSage 当前重点更偏：

```text
simulate
risk
policy
trust
verdict
```

所以 Parallax 不应该和它竞争：

> “我们也会给 ALLOW / DENY。”

而应该强调：

> **we don't stop at the verdict.**

---

# 26. 一个非常接近 Parallax 产品哲学的案例：TickTape

> 证据等级：C（早期产品自发布材料）。

Source: https://ticktape.cc/

TickTape 是 Polymarket agent preflight：

> “Your agent can trade. TickTape tells it when not to.”

工作流：

```text
Agent Intent
↓
live liquidity / fees / copyability evidence
↓
OK / CAUTION / VETO
```

支持：

- REST API
- MCP
- npm SDK
- x402 pay-per-call
- deterministic sandbox

---

# 27. TickTape 的数据给了一个很好的垂直证明

> 证据等级：C（self-published sample replay）。

TickTape 自报的一组 sample replay：

- 24 个高活跃 wallet
- **18 / 24** 在 explicit fees + slippage 后会让 copier 亏钱
- 只有 6 个 fee-inclusive positive
- survivor 还要通过 out-of-sample validation

Sources:

- https://ticktape.cc/
- https://ticktape.cc/tech
- https://ticktape.cc/data

证据等级：**C — startup self-published**。

不能外推成：

> “75% of copy trading loses money.”

只能写：

> In one transparent self-published TickTape sample, 18 of 24 highly active wallets would have produced negative copy returns after fees and slippage.

---

# 28. TickTape 为什么特别值得 Parallax 参考？

它验证了三个产品假设：

## 1. Independent preflight 可以独立存在

不一定必须是 wallet / DEX 自带 feature。

## 2. Agent 可以直接成为 API customer

通过：

```text
HTTP + MCP + x402
```

购买 verdict。

## 3. Data / execution 已存在，仍然需要 judgment

Polymarket 已经有 data 和 execution；TickTape 卖的是：

```text
Evidence
↓
Decision
```

这与 Parallax 高度类似。

---

# 29. 当前市场真实分布

## Layer 1 — Execution / Routing

**成熟、拥挤**

代表：

- Uniswap
- Camelot
- CoW
- LI.FI / Jumper
- Enso
- aggregators

回答：

> How do I execute?

---

## Layer 2 — Simulation / Security Evidence

**成熟、拥挤**

代表：

- Tenderly
- Blockaid
- Hypernative
- GoPlus
- protocol-native simulation

回答：

> What will happen / is this malicious?

---

## Layer 3 — Authorization / Agent Wallet Policy

**2026 正在快速 commoditize**

代表：

- MetaMask Agent Wallet
- Coinbase Agentic Wallet
- OKX Agentic Wallet
- Safe / smart account policies

回答：

> Is this within allowed permissions?

---

## Layer 4 — Independent Decision / Preflight

**Emerging；已经不是空白**

代表：

- ChainSage
- TickTape
- Hypernative Transaction Guard（部分重叠）
- PACE（academic）

回答：

> Should this action proceed?

---

## Layer 5 — Remediation + Re-verification

目前公开市场上相对更稀缺：

```text
Why not?
↓
Which exact variable matters?
↓
What should change?
↓
Change
↓
Re-run
↓
Did it fix the problem?
```

这里才是 Parallax 更可信的 wedge。

---

# 30. 所以“market gap”应该怎么写？

## 不再建议

> “There is no decision layer.”

已经不成立。

## 建议

> **Pre-execution protection is increasingly standard, but most systems stop at simulation, security scoring, policy enforcement, or a terminal verdict. The remaining gap is turning heterogeneous evidence into a specific remediation and then proving that the remediation actually improved the transaction.**

中文：

> **交易前保护正在成为标准能力，但多数系统停在 simulation、安全评分、policy enforcement 或最终 verdict。Parallax 关注的是下一步：把不同来源的 Evidence 转换成明确 Cause 和可执行修正，并重新验证这次调整是否真的改善交易结果。**

---

# 31. “如果多了这一层，会有什么改变？”——已有 analogous evidence

目前无法直接说 Parallax 自己能节省多少钱，但可以从相邻产品看到四类效果。

## 1. Block / review before funds move

Blockaid / Hypernative 的厂商资料报告了 pre-sign guard 对风险 transaction 的阻止或升级能力；这些是相邻产品证据，不是 Parallax 的效果数据。

## 2. Better execution / less MEV / less failed gas

Flashbots Protect 已经在数千万真实 transaction 中提供保护，并返还 7,733+ ETH。

## 3. Lower operational burden

Hypernative 的 Edge Capital case 报告 manual review 最多降低约 90%。

## 4. Safer autonomous-agent execution

PACE controlled benchmark 中 unsafe execution 从 unguarded 0.80 降到 0.00。

这些都支持：

> **相邻产品和受控研究共同支持：在 execution 前插入独立判断层，可能改变 outcome；Parallax 必须用自己的 benchmark 验证效果。**

但不证明 Parallax 当前实现已经达到相同效果。

---

# 32. Parallax 自己的价值必须自己测

这是研究中最重要的结论之一。

继续找更多“crypto 每年损失几十亿美元”的宏观数字，对 Parallax 的证明价值会越来越低。

真正需要的是：

> **Parallax-specific empirical evidence。**

建议在 Open House 做一个：

# Parallax Arbitrum Decision Benchmark

---

# 33. Benchmark 的核心研究问题

> **有多少交易 simulation 成功，但仍违反用户明确的 economic intent？**

以及：

> **Parallax 给出的 targeted adjustment 有多少真的能在 re-verification 后改善结果？**

---

# 34. Benchmark 数据来源

可以使用：

```text
Arbitrum historical swap state
+
Camelot / Uniswap contracts
+
archived RPC / mainnet fork
+
Tenderly simulation
```

建议先做：

```text
100–500 historical / replayed swap scenarios
```

不需要真实投入资金。

---

# 35. Baseline 对比

## Baseline A — Execution-only

```text
simulation = SUCCESS
→ execute / continue
```

## Baseline B — Standard transaction protection / DEX UX

可以包含：

- quote；
- 协议 `amountOutMinimum`；
- slippage tolerance；
- standard price-impact warning；
- router execution protection。

这些机制保护 calldata 或提供常规 UX，但不必然表达独立的用户经济约束。

## Parallax

```text
User Intent
+
Independent Economic Constraints
+
Evidence
↓
Cause
↓
Decision
↓
Relevant Action
↓
Re-verification
```

Benchmark 应测量 Parallax 是否能捕捉那些没有被交易 calldata / 协议保护完整强制执行的约束违规。

---

# 36. 建议 scenario

## Scenario 1 — Minimum effective rate

```text
simulation = SUCCESS
BUT
effectiveRate < user minEffectiveRate
```

## Scenario 2 — Excessive price impact

```text
simulation = SUCCESS
BUT
priceImpact > user maxPriceImpact
```

## Scenario 3 — Excessive total cost

```text
simulation = SUCCESS
BUT
allInCost > user maxTotalCost
```

## Scenario 4 — Trade size creates unacceptable impact

```text
large amount
→ price impact above policy
→ reduce amount / split
→ re-run
→ verify improvement
```

## Scenario 5 — Stale Evidence

```text
Evidence valid at T0
→ chain state changes
→ Evidence no longer fresh
→ UNKNOWN / requote / resimulate
```

## Scenario 6 — Provider capability gap

```text
Provider A = richer Evidence
Provider B = partial Evidence
→ Checked / Not Checked / Unknown remain correct
```

这些 scenario 以独立用户经济约束为主，不把协议 transaction `amountOutMinimum` 当作 Parallax 的核心经济差异。如果未来保留绝对最低输出量场景，必须明确标注为独立 user economic constraint，而不是协议内置的 `amountOutMinimum`。

---

# 37. 最值得记录的 KPI

## 1. False-Allow Rate

Baseline 中：

```text
simulation success
BUT
explicit user boundary violated
```

仍然被放行的比例。

## 2. Recoverable Decision Rate

所有 ADJUST 中，有多少通过 targeted action 后转为 PROCEED？

## 3. Economic Improvement

```text
Previous expected outcome
vs
Adjusted expected outcome
```

报告：

- absolute value
- bps
- percentage

## 4. Simulated Avoided Bad-Execution Value

只能叫：

> simulated / benchmark avoided value

除非真实交易，否则不能写 real money saved。

## 5. Decision Latency

Provider evidence + normalization + decision 需要多少 ms。

## 6. Re-verification Success Rate

推荐 action 后，实际 outcome 有多少真的改善。

这是最能证明 Parallax 区别于简单 verdict engine 的指标。

---

# 38. AI Agent 小型 benchmark

Best Case 可以加：

```text
LLM Agent only
vs
LLM Agent + Parallax
```

给同样的 Swap Intent，记录：

- intent-violating attempts
- unsafe attempts
- incorrect parameter changes
- human escalation
- successful remediation

Ground truth 必须来自：

```text
deterministic user constraints
+
onchain simulation
+
rule engine
```

不能让另一个 LLM 当 judge。

---

# 39. 一个真正强的最终结果应该长什么样？

例如最终格式可能是：

```text
300 swap scenarios

74:
simulation succeeded
but violated explicit user constraints

Parallax detected:
72 / 74

48:
had a deterministic relevant adjustment

41:
became acceptable after re-verification

Median economic improvement:
XX bps

False positive:
X%
```

**以上全部只是报告格式示例，不是真实数据。**

只有 benchmark 跑完后才能填数字。

---

# 40. 这会怎样改变 pitch？

现在我们只能说：

> “We believe a remediation layer is useful.”

如果 benchmark 成功，可以说：

> **“In our Arbitrum benchmark, X% of transactions that successfully simulated still violated the user's explicit economic constraints. Parallax caught Y%, and Z% of flagged transactions became acceptable after a targeted adjustment and re-verification.”**

这比：

> “Crypto loses billions every year.”

更能证明 Parallax 自己。

---

# 41. 当前最适合进入 pitch 的数据 shortlist

## Arbitrum scale

- ~1.3M daily transactions
- ~$73M daily DEX volume
- ~$614M daily perps volume
- ~94k daily active addresses

Source: DefiLlama；submission 前 refresh。

## Execution-risk evidence

- 1.33M sandwich attacks / ~$809M recorded user losses in one academic 3-year dataset。

## Behavioral evidence

- ~40% sandwich victims migrate to private routing within 60 days；repeated victims ~54%。

## Existing protection adoption

- Flashbots Protect：66M+ processed tx、7,733+ ETH refunds。

## Agent-guard evidence

- MetaMask / OKX / Coinbase 都把 guardrails 放进 agent execution path。
- PACE：controlled benchmark 中 unguarded unsafe rate 0.80 → 0.00。

---

# 42. 不应该放进 pitch 的 claim

不要写：

```text
“$X billion is lost every year because there is no decision layer.”
```

没有证据。

不要写：

```text
“AI agents have lost $X because they cannot judge transactions.”
```

没有可信 aggregate dataset。

不要写：

```text
“Parallax could have prevented the Bybit hack.”
```

当前产品能力不足以支持。

不要写：

```text
“75% of agent trades lose money.”
```

TickTape 的 18/24 只是单个 self-published sample。

不要把 Blockaid / Hypernative 的 vendor prevented-loss 数字直接当 Parallax TAM。

---

# 43. 最终产品 thesis 更新

原本：

> “Simulation tells us what will happen. Parallax tells us what to do next.”

仍然可以用，但现在不够 defensive。

因为：

- Hypernative 已经有 recommended action；
- ChainSage 已经有 verdict layer；
- TickTape 已经有 agent veto；
- PACE 已经有 policy decision record。

更强版本：

> **Parallax doesn't stop at “should this execute?” It identifies why the current action misses the user's intent, recommends the relevant change, and verifies whether that change actually fixed the transaction.**

或：

> **Parallax is the remediation and re-verification layer between heterogeneous onchain evidence and execution.**

---

# 44. 当前竞争地图

```text
Tenderly
→ simulation

Blockaid
→ security

Hypernative
→ security + policy + transaction guard

MetaMask / OKX / Coinbase
→ wallet authorization + agent guardrails

ChainSage
→ agent transaction verdict

TickTape
→ vertical market preflight

PACE
→ policy-attested authorization

Parallax
→ evidence normalization
   + economic intent
   + Cause
   + targeted remediation
   + re-verification
```

这比“没人做 decision layer”更可信。

---

# 45. 最终判断

这轮研究的真正发现不是：

> “Parallax 找到了一个完全没人发现的市场空白。”

而是：

> **市场已经明显验证 pre-execution judgment 是真实需求，但这个类别正在快速形成，Parallax 必须占据更精确的位置。**

最有证据支持的 wedge 是：

> **从 heterogeneous evidence 到 specific remediation，再到 re-verification 的闭环。**

下一步最值得做的不是继续找更多宏观 crypto loss statistic，而是：

> **在 Arbitrum 上建立 Parallax Decision Benchmark，直接证明有多少 simulation-success transactions 仍然违反 user intent，以及 Cause → Action → Re-run 实际能改善多少。**

如果这个结果强，Parallax 的 thesis 就会从：

```text
plausible
```

升级成：

```text
empirically demonstrated
```

---

# Safe Claims / Unsafe Claims

## Safe claims

- Execution risk, poor execution, slippage, price impact, MEV, sandwiching, and failed transactions can create measurable user or protocol losses when supported by the cited Grade A/B/C evidence.
- Users change routing and execution behavior after bad execution; the cited behavioral studies support this without proving Parallax adoption or retention.
- Pre-execution protection and policy guardrails show demonstrated adjacent adoption/value through the cited Flashbots, CoW, Blockaid, Hypernative, and agent-wallet evidence.
- Controlled research supports using deterministic external verification around agent or transaction execution; it does not prove production safety.
- Independent preflight and decision products are emerging, so a generic decision layer is not an uncontested category.
- No mature dominant product was identified that clearly centers the complete provider-agnostic economic `Cause → Action → Re-verification` loop. This is a research observation, not proof of market monopoly or PMF.

## Unsafe claims

The following claims are not supported by this research and must not be used:

- “$X billion is lost every year because there is no Parallax.”
- “AI agents lose $X because they lack Parallax.”
- “Parallax would have prevented the Bybit hack.”
- “Parallax could prevent the entire MEV or sandwich-loss dataset.”
- Blockaid or Hypernative vendor-reported prevented-loss numbers equal Parallax TAM.
- Historical unfavorable-trade rates describe current Arbitrum execution quality.
- Generic preflight or decision products form an uncontested market.

---

# 46. Reference List

## A — Academic / Independent

1. An anti-sandwich mechanism for EVM’s smart contracts
   https://www.sciencedirect.com/science/article/abs/pii/S0167739X25003711

2. Linking MEV attacks to further maximise attackers' gains
   https://www.sciencedirect.com/science/article/pii/S2096720925000673

3. Sandwiched and Silent: Behavioral Adaptation and Private Channel Exploitation in Ethereum MEV
   https://arxiv.org/abs/2512.17602

4. An Empirical Study of Market Inefficiencies in Uniswap and SushiSwap
   https://arxiv.org/abs/2203.07774

5. Understanding Slippage in Automated Market Makers
   https://www.mdpi.com/2813-5288/4/3/8

6. Rolling in the Shadows: Analyzing the Extraction of MEV Across Layer-2 Rollups
   https://arxiv.org/abs/2405.00138

7. AI-Trader: Benchmarking Autonomous Agents in Real-Time Financial Markets
   https://arxiv.org/abs/2512.10971

8. PACE: Policy-Attested Contract Execution for Safe AI Agents in DeFi
   https://arxiv.org/abs/2608.17220

9. NCC Group — Bybit Hack: In-Depth Technical Analysis
   https://www.nccgroup.com/research/in-depth-technical-analysis-of-the-bybit-hack/

## Arbitrum / Protocol Official

10. Arbitrum H1 2026
    https://blog.arbitrum.foundation/arbitrum-h1-2026-the-programmable-economy-is-accelerating/

11. DefiLlama — Arbitrum
    https://defillama.com/chain/arbitrum

12. Arbitrum Treasury Management Report
    https://forum.arbitrum.foundation/t/arbitrum-treasury-management-report-by-aera/20652

13. Uniswap — Price Impact
    https://support.uniswap.org/hc/en-us/articles/40074715860365-What-is-price-impact

14. Uniswap Developers — Swaps
    https://developers.uniswap.org/docs/get-started/concepts/traders/swaps

15. Uniswap — Minimize Slippage
    https://blog.uniswap.org/es-ES/minimize-slippage-on-swaps

## B — Vendor / Product Telemetry

16. Flashbots Protect
    https://protectrpc.flashbots.net/

17. Flashbots Protect / MEV-Share data
    https://collective.flashbots.net/t/publishing-flashbots-protect-and-mev-share-data/3087

18. Blockaid
    https://blockaid.io/

19. Blockaid Transaction Security
    https://blockaid.io/transaction-security

20. Hypernative Transaction Guard
    https://www.hypernative.io/product/transaction-guard

21. Hypernative × Edge Capital
    https://hypernative.io/insights/blog/how-edge-capital-scaled-transaction-security-and-expanded-defi-reach-with-hypernative-guardian

22. CoW Protocol
    https://cow.fi/cow-protocol

23. CoW DAO CIP-58
    https://forum.cow.fi/t/cip-58-funding-for-development-services-service-agreement-no-4/2686

## Agent Wallet Official

24. MetaMask Agent Wallet
    https://metamask.io/news/introducing-metamask-agent-wallet

25. MetaMask Agent Wallet Security
    https://metamask.io/news/agentic-wallet-security

26. OKX Agentic Wallet
    https://www.okx.com/en-sg/learn/agentic-wallet

27. Coinbase Agentic Wallets
    https://www.coinbase.com/developer-platform/products/agentic-wallets

## Direct / Emerging Competitors

28. ChainSage
    https://www.chainsage.finance/

29. TickTape
    https://ticktape.cc/

30. TickTape Data
    https://ticktape.cc/data

31. TickTape Technical Methodology
    https://ticktape.cc/tech

32. TickTape Developer API / MCP
    https://ticktape.cc/developers

33. GoPlus AgentGuard
    https://github.com/GoPlusSecurity/agentguard

---

# 47. Research Integrity Note

本文故意没有给出：

```text
“Parallax TAM = $X”
“每年因缺乏 decision layer 损失 $X”
“AI agents 已损失 $X”
```

因为目前没有可靠来源支持这些具体结论。

如果后续需要 hackathon / investor deck 里的 Parallax-specific quantitative proof，优先完成：

> **Parallax Arbitrum Decision Benchmark**

这会比任何泛化的行业损失数字更能证明产品需求。
