# Parallax PRD｜Hackathon MVP P0

## 1. Product Summary

**Parallax is a Moss-powered pre-transaction decision layer for Monad swaps.**

Parallax 在用户签名或失败后再次重试之前，基于真实执行证据，帮助用户判断当前交易应该：

- **PROCEED**：在本次已检查范围内未发现阻断证据；
- **ADJUST**：修改一个相关交易条件后重新检查；
- **STOP**：停止当前路径，或更换 Route／Token Pair；
- **UNKNOWN**：证据不足，暂不作出可信结论。

核心表达：

> **Moss tells us what will happen. Parallax tells the user what to do next.**

Parallax 的核心不是生成更长的 Risk Report，也不是判断一笔交易“绝对安全”，而是把可追溯的执行证据转换成清晰、可行动、可重新验证的交易决定。

---

## 2. Primary User

P0 采用以下工作假设：

> 在 Monad 上进行基础 Swap、理解基本钱包与交易操作，但无法判断失败原因和正确调整方式的轻度 DeFi 用户。

P0 不以以下用户为主要对象：

- 完全没有钱包或 Swap 使用经验的零基础用户；
- 专业 Trader；
- 机构用户；
- Agent Builder；
- 智能合约开发者和调试人员。

该用户画像是本次黑客松的产品假设，不代表已经完成完整市场验证。

---

## 3. Trigger Moment

Parallax 介入的主要时刻：

> 用户已经形成 Swap Intent，在签名之前，或在一次失败后准备再次重试之前。

P0 不覆盖：

- 长期协议研究或评级；
- 交易完成后的 Portfolio 分析；
- Agent 自动提交交易；
- 自动签名或自动广播。

---

## 4. User Problem

普通 Swap 页面或原始 Simulation 往往只能显示失败、Warning 或技术错误，用户仍无法清楚回答：

- 为什么失败；
- 当前问题属于 Route、余额、参数还是系统集成；
- 哪些调整与问题相关；
- 哪些修改不会解决当前问题；
- 修改后结果是否真的变化；
- 即使交易能执行，是否符合自己明确声明的接受边界。

### 4.1 Primary Problem｜A

> Swap 失败后，用户不知道应该修改 Slippage、Priority Fee、金额、Token Pair 还是 Route，因而可能反复进行无效重试。

### 4.2 Optional Economic Boundary｜B

`Minimum Received` 是用户声明的接受边界，而不是 Parallax 自动生成的“安全阈值”。

原则：

- A 主流程不要求 `minimumReceived` 必填；
- 只有存在明确边界时，才启用 Economic Boundary Rule；
- 修改 Route 或 Amount 可能改变交易结果；
- 降低 `minimumReceived` 只是在放宽接受条件，不代表结果改善；
- Parallax 不得为了产生 `PROCEED` 而主动建议用户降低该边界；
- P0 不生成基于 AI、外部市场价格或复杂模型的“推荐安全阈值”。

边界来源必须记录为：

```ts
type BoundarySource =
  | "original_swap"
  | "user_declared"
  | "demo_preset"
  | "unavailable";
```

其中：

- `original_swap`：由原交易或原 DEX Intent 明确提供；
- `user_declared`：由用户明确输入；
- `demo_preset`：仅用于明确标注的 Demo／Replay，不得冒充真实用户边界；
- `unavailable`：当前没有可用边界，不执行 Economic Boundary Rule。

### 4.3 Conditional Fallback｜E

> Simulation Success 和 Zero Warning 不代表经济结果一定可以接受。

E 只在存在明确边界时启用，作为第二演示场景或技术 Fallback，不改变 Primary User，也不作为独立市场定位。

---

## 5. Product Goal

P0 必须完成以下行为闭环：

```text
Swap Intent
→ Moss Evidence
→ 原因分类
→ 用户 Verdict
→ 一个相关调整
→ 一个有证据支持的无关调整
→ 用户修改一个条件
→ Re-run
→ Previous vs New Result
```

P0 的成功标准不是覆盖所有风险，而是至少完成一条真实、稳定、可解释、可重新验证的用户决策闭环。

---

## 6. Product Form

P0 产品形态：

> **钱包式单页 Web App**

### Confirmed Boundaries

- 不开发浏览器插件；
- 不做完整 DEX 嵌入；
- 不以聊天式 AI Agent 作为主界面；
- 不签名；
- 不广播；
- 不托管资产；
- Moss Trace 默认折叠；
- 完成一次明确修改后的 Re-run；
- Re-run 后展示 `Previous → New`。

### Non-blocking UX Decisions

以下内容可在实现过程中冻结，不阻塞开发：

- 结构化 Swap Form 是否为唯一入口；
- 自然语言输入是否作为 Stretch；
- Wallet Connect 是否只读、可选，且不阻塞核心流程；
- Primary CTA 的最终文案；
- Evidence Drawer 的最终视觉层级。

无论最终 UX 如何，核心检查必须能够直接接收结构化 Intent，不依赖自然语言或钱包连接。

---

## 7. Core User Flow

```text
1. User enters a Swap Intent
2. User starts the pre-sign check
3. Parallax runs the Moss workflow
4. Parallax normalizes the evidence
5. Deterministic rules produce a decision
6. UI explains the cause and next action
7. User changes one relevant condition
8. Parallax re-runs the check
9. UI compares the previous and new result
10. Technical evidence remains available on demand
```

每个结果必须回答：

1. **What happened?**
2. **What proves it?**
3. **What can you change?**
4. **What will not help?**

---

## 8. Verdict Model

| Verdict | Product meaning | Expected user action |
|---|---|---|
| `PROCEED` | 在本次已检查范围内未发现阻断证据 | 返回原交易流程或查看证据 |
| `ADJUST` | 当前交易条件需要修改，修改后可以重新检查 | 修改一个相关条件并 Re-run |
| `STOP` | 当前路径无法执行或不应继续 | 更换 Route／Token Pair 或停止 |
| `UNKNOWN` | 缺少可靠证据，无法作出可信结论 | 查看缺失证据，不自动放行 |

### 8.1 `PROCEED` 的承诺边界

`PROCEED` 不代表：

- 交易绝对安全；
- 协议整体可靠；
- Token 不存在恶意风险；
- 未来价格不会变化；
- Parallax 推荐用户进行该交易。

推荐用户层文案：

> **No blocking evidence found in the checked scope.**  
> 在本次已检查范围内，未发现阻止继续的证据。

存在明确经济边界时，可以补充：

> **Meets your declared boundary.**  
> 当前结果满足你声明的接受边界。

不得使用：

- `Safe to proceed`
- `Recommended`
- `Transaction is safe`
- 其他暗示完整安全审查已经完成的表达

### 8.2 Scope Disclosure

结果必须能够表达：

#### Checked

- Execution result；
- Moss warnings；
- 用户声明的 Minimum Received（如有）。

#### Not Checked

- 完整协议安全；
- 完整恶意 Token 覆盖；
- 所有资产语义；
- 未来市场变化。

#### Unknown

- 当前 Run 缺失或不支持的关键证据。

`Checked / Not Checked / Unknown` 是必须表达的产品语义，但具体可以放在主结果摘要、Scope 标签或 Evidence Drawer 中，不强制全部堆叠在第一屏。

---

## 9. System Failure Isolation

系统状态与用户 Verdict 在数据层分离：

```ts
type SystemStatus =
  | "OK"
  | "INTEGRATION_ERROR";

type UserVerdict =
  | "PROCEED"
  | "ADJUST"
  | "STOP"
  | "UNKNOWN";
```

当 Moss、RPC 或应用服务发生故障时：

- 不生成协议 `FAIL`；
- 不声称交易危险；
- 返回可重试错误或 Replay；
- UI 必须说明检查未完成；
- 是否同时显示 `UNKNOWN` 可由最终 UX 决定。

核心产品原则：

> 系统无法完成检查，不等于协议或交易存在风险。

---

## 10. P0 Rule Groups

规则必须是确定性、可测试的纯函数。LLM 只可用于自然语言解释或 Intent 辅助解析，不参与最终裁决。

### 10.1 Execution

至少识别：

- `SUCCESS`
- `NO_ROUTE`
- `REVERTED`
- `UNKNOWN`

系统集成故障不作为协议规则失败。

### 10.2 Economic Boundary

仅在存在明确边界时执行：

```text
expectedOutput >= minimumReceived
```

输出只能表述为是否符合用户声明的边界，不能表述为交易是否“安全”或“划算”。

### 10.3 Evidence Completeness

检查：

- 是否存在 Moss Warning；
- 是否存在无法解释的关键 Asset Change；
- 是否缺少作出判断所需的字段；
- 是否存在来源不明或不可复现的数据。

### Rule Principles

- `UNKNOWN` 不等于 `PASS`；
- `UNKNOWN` 也不自动等于协议风险；
- Simulation Success 不自动等于 `PROCEED`；
- Zero Warning 不等于经济结果可接受；
- Mock 不得支撑核心 Verdict；
- Approval Rule 只在真实 Action 包含 Approval 时执行；
- Price Impact 只有在数据定义和可比性得到验证后，才可进入硬规则。

---

## 11. Frozen Behaviour Contract

Primary Scenario A 必须满足：

```text
一个真实、可识别的原因
→ 一个有证据支持的相关调整
→ 一个有证据支持的无关调整
→ 用户修改一个条件
→ Re-run
→ 得到新的明确结果
```

初始 Reason-to-Action Mapping 仅作为待验证假设：

| Cause | Required evidence | Potentially relevant adjustment | Usually irrelevant adjustment | Expected verdict |
|---|---|---|---|---|
| No Route | Moss Quote／Action | Route、Token Pair | Priority Fee、盲目提高 Slippage | STOP |
| Output below boundary | Quote／Outcome + explicit boundary | Route、Amount | Gas | ADJUST |
| Balance／Transfer Failure | Moss + RPC balance query | Amount、Balance | 盲目提高 Slippage | ADJUST／STOP |
| Moss Warning | Simulation／Receipt | 取决于具体 Warning | 无证据时不猜 | ADJUST／UNKNOWN |
| Missing Evidence | 缺失字段清单 | 补充数据或更换场景 | 直接放行 | UNKNOWN |

最终进入产品逻辑的映射必须由真实 Moss／RPC 证据验证。

---

## 12. Adjustable Parameters

候选可修改参数：

- Amount；
- Token Pair；
- Route／Protocol；
- Slippage；
- Minimum Received。

其中：

- Amount、Token Pair、Route／Protocol、Slippage 属于交易条件；
- Minimum Received 属于用户接受边界；
- 系统不得把降低 Minimum Received 描述为改善交易结果。

前端不应假设所有参数在所有原因下都可修改。API 应返回原因对应的建议：

```ts
type ActionSuggestion = {
  field:
    | "amountIn"
    | "tokenPair"
    | "protocol"
    | "slippage"
    | "minimumReceived";
  category:
    | "TRANSACTION_CONDITION"
    | "ACCEPTANCE_BOUNDARY";
  relevance:
    | "RELEVANT"
    | "IRRELEVANT"
    | "UNKNOWN";
  reason: string;
};
```

最终可编辑字段由技术团队根据已验证的 Reason-to-Action Mapping 冻结。

---

## 13. Evidence Disclosure

主页面优先展示：

- Verdict；
- 一句话原因；
- 推荐动作；
- 无效动作；
- Previous vs New Result；
- 必要的 Scope Disclosure。

系统至少应保存：

- Moss workflow stage；
- Protocol；
- Route；
- Quote；
- Simulation status；
- Asset changes；
- Warnings；
- Revert reason；
- Evidence source；
- Block number；
- Rule results；
- Unknown reasons；
- Boundary source；
- Moss version；
- Rule version；
- Replay mode。

Evidence Drawer 的最终字段和视觉层级由实现团队决定，但必须满足：

- 技术详情按需展开；
- 不默认倾倒完整 Raw Moss Output；
- Mock、Derived、Replay 与 Unknown 明确标注；
- Raw Evidence 能支持核心 Verdict 的复核；
- Replay 不得伪装成现场实时调用。

---

## 14. Moss Integration Boundary

### Moss 负责

- `discover`
- `load`
- `action`
- `simulate`
- 构造未签名交易能力；
- 返回 Receipt、Warnings、Changes、Outcome 与可用的 Revert Reason。

### Moss 不负责

- 判断用户是否接受结果；
- 推荐用户修改什么；
- 自动签名；
- 自动广播；
- 形成 Parallax 的最终用户 Verdict。

### Parallax 负责

- 保存原始 Intent；
- 调用 Moss；
- 归一化 Moss Raw Output；
- 必要时补充 RPC Query；
- 执行确定性 Rule；
- 生成 Decision；
- 支持 Adjust & Re-run；
- 隔离 Integration Error。

核心流程：

```text
Intent
→ Moss discover
→ Moss load
→ Moss action
→ Moss simulate
→ Normalized Evidence
→ Rule Engine
→ User Decision
→ Receipt
```

前端和 Rule Engine 不应直接依赖 Moss 原始类型。

---

## 15. Baseline E2E and Primary Scenario

### 15.1 Baseline E2E

默认技术基线：

```text
Kuru
MON → USDC
Quote
→ Action
→ Simulation
→ Raw Evidence
→ Normalized Evidence
```

该链路用于证明真实 Moss 集成可以运行，不要求同时承担失败 Demo。

### 15.2 Primary Scenario A Fixture

A 的具体 Token Pair、Sender、失败原因和调整参数，由技术团队根据真实可复现性选择。

A 不必强行使用 `MON → USDC`。

技术团队可以采用：

- `NO_ROUTE`
- Transfer Failure
- 其他 Moss 能稳定识别并解释的真实原因

但必须满足第 11 节的 Frozen Behaviour Contract。

### 15.3 PancakeSwap

PancakeSwap 不阻塞 Kuru P0。

只有在以下条件满足时才进入正式 P0：

- 真实链路稳定；
- 字段来源完整；
- 集成失败可以隔离；
- 不阻塞 Kuru；
- 对 E 或用户决策有明确增量。

否则降为 `UNAVAILABLE`、P1 或 Stretch。

---

## 16. Reference API Contract

以下为产品所需的最小参考形态，最终内部路由和 Schema 由技术团队冻结：

```text
POST /api/check
GET  /api/replay/:id
```

Re-run 可继续调用 `/api/check`，并附带 `parentRunId`。

```ts
type CheckSwapInput = {
  parentRunId?: string;
  sender?: string;
  recipient?: string;
  protocol: "kuru" | "pancake";
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  minimumReceived?: string;
  minimumReceivedSource?: BoundarySource;
  slippage?: string;
};

type CheckSwapResult = {
  runId: string;
  parentRunId?: string;

  systemStatus: "OK" | "INTEGRATION_ERROR";
  verdict: "PROCEED" | "ADJUST" | "STOP" | "UNKNOWN";

  summary: string;
  recommendedActions: ActionSuggestion[];
  irrelevantActions: ActionSuggestion[];

  checked: string[];
  notChecked: string[];
  evidence: EvidenceItem[];
  ruleResults: RuleResult[];
  unknowns: UnknownItem[];

  diff?: RunDiff;
  replayMode: boolean;
};
```

所有 BigInt 跨 API 必须序列化为 string。

---

## 17. Decision Receipt

P0 Receipt 应至少能够表达：

```text
runId
parentRunId
intent
protocol
route
quote
simulationStatus
assetChanges
warnings
evidenceSources
ruleResults
systemStatus
verdict
recommendedActions
irrelevantActions
checked
notChecked
unknowns
minimumReceived
minimumReceivedSource
blockNumber
createdAt
ruleVersion
mossVersion
replayMode
```

最终字段拆分、存储方式和 Evidence Drawer 映射由技术团队在共享 Contract 中冻结。

---

## 18. Smart Contract Boundary

P0 不新增自研智能合约。

Onchain component 来自：

- Moss 构造的真实 Kuru 智能合约 Action；
- 对未签名交易的真实 Simulation；
- Monad 链上 Quote、Receipt 和 Asset Change Evidence。

P0 不实现：

- Receipt Registry；
- 链上 Risk Verdict；
- 用户签名；
- Swap 广播；
- Token Custody；
- 自研交易执行合约。

---

## 19. Functional Requirements

### FR-01｜Intent Capture

系统能够接收结构化 Swap Intent，并转换为统一内部格式。

### FR-02｜Moss Execution Evidence

系统能够完成至少一个真实 Kuru Quote、Action、Simulation 和 Receipt 获取。

### FR-03｜Evidence Normalization

系统将 Moss 和必要 RPC 数据转换为不依赖 Moss 原始类型的结构化 Evidence。

### FR-04｜Deterministic Decision

系统使用确定性规则产生 PROCEED、ADJUST、STOP 或 UNKNOWN。

### FR-05｜Scope-aware Explanation

系统解释发生了什么、证据是什么、可以改什么、什么改了也无效，并说明 Checked、Not Checked 和 Unknown。

### FR-06｜Adjust & Re-run

用户能够修改一个相关条件并重新执行检查。

### FR-07｜Result Diff

系统展示 Previous 与 New Result 的关键变化。

### FR-08｜Evidence Access

用户能够按需展开 Evidence，而不是在主页面默认查看完整 Raw Data。

### FR-09｜Failure Isolation

Moss、RPC 或应用集成错误不得被展示为协议风险。

### FR-10｜Replay

核心 Demo 能够在现场调用失败时加载明确标注的真实录制 Fixture。

### FR-11｜Boundary Integrity

只有存在明确 Minimum Received 时才执行 Economic Boundary Rule，且系统不得建议降低边界以制造 PROCEED。

---

## 20. Non-functional Requirements

- 核心判断可测试、可复现；
- 核心 Verdict 不依赖 LLM；
- Mock 不得冒充真实链上证据；
- 真实数据尽量记录来源和区块；
- Unknown 不得被静默转换为 Pass；
- Integration Error 与协议风险分开；
- 前端不得直接依赖 Moss Raw Type；
- P0 不需要持久化历史数据库；
- P0 不预先引入复杂 Queue 或 SSE；
- 主流程必须适合三分钟内演示；
- 目标完成日期：**2026-08-05**。

---

## 21. P0 Acceptance Criteria

P0 达成需要满足：

1. 至少一个真实 Kuru Swap Intent 可完成 Moss Quote → Action → Simulation；
2. Moss Evidence 能被归一化为统一数据结构；
3. 至少一个真实 A 场景能产生明确原因；
4. 该场景包含一个有证据支持的相关调整；
5. 该场景包含一个有证据支持的无关调整；
6. 用户能够修改一个条件并 Re-run；
7. UI 能展示 Previous 与 New Result；
8. 系统能够返回 PROCEED、ADJUST、STOP 或 UNKNOWN；
9. PROCEED 不被表达为绝对安全或交易推荐；
10. UI 能表达 Checked、Not Checked 和 Unknown；
11. Integration Error 不被展示为协议风险；
12. Unknown 不被自动放行；
13. 所有核心证据不是 Mock；
14. Replay Fixture 被明确标记为 Replay；
15. Economic Boundary Rule 只在明确边界存在时执行；
16. 产品不签名、不广播、不托管。

---

## 22. Out of Scope

P0 明确不包含：

- DEX Aggregator；
- 完整 Protocol Rating；
- 多套 Personal Policy；
- 复杂 Risk Band；
- 大型 Risk Dashboard；
- 8–12 条以上规则；
- Session History；
- SQLite；
- 复杂异步任务系统；
- AI 自主裁决；
- 聊天式 Agent 主界面；
- 浏览器插件；
- 真实 Swap 签名与广播；
- 自研智能合约；
- Lending／Yield；
- Position Token 语义；
- 完整双协议 Risk Report；
- AI 或外部模型生成的安全阈值；
- 未验证数据条件下的 Price Impact 硬规则。

---

## 23. Frozen Decisions, Implementation Gates and Post-hackathon Validation

### 23.1 Frozen Product Decisions

- Primary User 采用当前轻度 DeFi 用户工作假设；
- A 是 Primary Problem；
- B 是可选经济边界，并记录来源；
- E 是依赖明确边界的条件性 Fallback；
- PROCEED 只表示已检查范围内未发现阻断证据；
- 产品是钱包式单页 Web App；
- P0 完成一次相关调整与 Re-run；
- Moss Trace 默认折叠；
- 不签名、不广播、不托管；
- 不新增自研智能合约；
- PancakeSwap 不阻塞 Kuru。

### 23.2 Required Implementation Validation

由技术团队在实现、共享 Contract、测试、PR 或 ADR 中冻结：

- A 的具体真实 Fixture；
- Moss version／commit；
- RPC、Sender、Token Address；
- API、Receipt 与 Evidence 最终 Schema；
- Integration Error 的内部错误结构；
- Error Mapping；
- BigInt 序列化实现；
- Replay Fixture 格式；
- Timeout／Retry；
- Evidence Drawer 技术字段；
- Price Impact 与 Approval 的技术可用性；
- PancakeSwap Go／No-Go。

这些事项不阻塞产品开发启动。

### 23.3 Non-blocking UX Decisions

由 Product、UX 与技术实现共同收敛：

- 自然语言是否进入 Stretch；
- Wallet Connect 是否进入 P0；
- Primary CTA 最终文案；
- Evidence Drawer 信息层级；
- Integration Error 的页面呈现；
- 具体哪些已验证参数在对应场景中可编辑。

### 23.4 Post-hackathon Validation

本轮不作为开发前置条件：

- 目标问题的真实发生频率；
- 用户是否愿意增加一次签名前检查；
- 产品未来采用钱包插件、DEX 嵌入还是其他入口；
- 更完整的市场与用户验证；
- 是否扩展复杂 Policy、协议评级或更多 Action。

---

## 24. Product Principle

> **A feature belongs in P0 only when it helps the user make a clearer pre-transaction decision and can be supported by real, traceable evidence.**
